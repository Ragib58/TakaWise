import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  CreateShareRequest,
  FamilyRole,
  SharedResource,
  WorkspaceDetail,
  WorkspaceSummary,
} from '@takawise/contracts';
import { AppException } from '../../../common/errors/app.exception';
import type { ClientContext } from '../../../common/http/client-context';
import { APP_CONFIG } from '../../../config/config.module';
import type { AppConfig } from '../../../config/env';
import { generateInviteCode } from '../../../domain/saas/signatures';
import { toMoneyString, ZERO } from '../../../domain/money/money';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { AuditService, type AuditAction } from '../../audit/audit.service';
import { hmacHex } from '../../auth/crypto/secure-tokens';
import { BudgetsService } from '../../budgets/budgets.service';
import { EMAIL_SENDER, type EmailSender } from '../../email/email.types';
import { GoalsService } from '../../goals/goals.service';
import { LedgerService } from '../../ledger/ledger.service';
import { EntitlementsService, planRequired } from '../entitlements.service';
import { FeatureFlagsService } from '../feature-flags.service';

type Membership = { workspaceId: string; userId: string; role: FamilyRole };

const notFound = () =>
  new AppException('NOT_FOUND', 'The requested resource was not found.', HttpStatus.NOT_FOUND);
const forbidden = (message = 'You do not have permission to perform this action.') =>
  new AppException('FORBIDDEN', message, HttpStatus.FORBIDDEN);
const conflict = (message: string) => new AppException('CONFLICT', message, HttpStatus.CONFLICT);
const badCode = () =>
  new AppException(
    'INVALID_OR_EXPIRED_CODE',
    'The code is invalid or has expired. Ask for a new invitation.',
    HttpStatus.BAD_REQUEST,
  );

const isManager = (role: FamilyRole) => role === 'OWNER' || role === 'ADMIN';

/**
 * Family workspaces (ADR-026). Membership is checked on every request, and a
 * member only ever sees what another member explicitly shared — never their
 * other accounts, transactions or notes. Removing a member revokes their
 * shares in the same transaction, so access ends immediately both ways.
 */
@Injectable()
export class FamilyService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    private readonly entitlements: EntitlementsService,
    private readonly flags: FeatureFlagsService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly budgets: BudgetsService,
    private readonly goals: GoalsService,
  ) {}

  // ─────────────────────────────── Workspaces ───────────────────────────────

  async list(userId: string): Promise<WorkspaceSummary[]> {
    const rows = await this.prisma.familyMember.findMany({
      where: { userId, status: 'ACTIVE' },
      include: {
        workspace: {
          include: { _count: { select: { members: { where: { status: 'ACTIVE' } } } } },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.workspaceId,
      name: r.workspace.name,
      myRole: r.role,
      memberCount: r.workspace._count.members,
    }));
  }

  async create(userId: string, name: string, client: ClientContext): Promise<WorkspaceDetail> {
    await this.flags.assertOn('family.workspaces');
    await this.entitlements.assertFeature(userId, 'familyWorkspace');
    const owned = await this.prisma.familyWorkspace.count({ where: { ownerId: userId } });
    if (owned > 0) throw conflict('You already own a family workspace.');
    const workspace = await this.prisma.$transaction(async (tx) => {
      const ws = await tx.familyWorkspace.create({ data: { ownerId: userId, name } });
      await tx.familyMember.create({ data: { workspaceId: ws.id, userId, role: 'OWNER' } });
      await this.audit.record(
        {
          action: 'family.workspace.created',
          userId,
          entityType: 'family_workspace',
          entityId: ws.id,
        },
        client,
        tx,
      );
      return ws;
    });
    return this.detail(userId, workspace.id);
  }

  async detail(userId: string, workspaceId: string): Promise<WorkspaceDetail> {
    const me = await this.membership(userId, workspaceId);
    const workspace = await this.prisma.familyWorkspace.findUniqueOrThrow({
      where: { id: workspaceId },
    });
    const [members, invitations, shares, owner] = await Promise.all([
      this.prisma.familyMember.findMany({
        where: { workspaceId, status: 'ACTIVE' },
        include: { user: { select: { email: true, profile: { select: { fullName: true } } } } },
        orderBy: { joinedAt: 'asc' },
      }),
      isManager(me.role)
        ? this.prisma.familyInvitation.findMany({
            where: {
              workspaceId,
              acceptedAt: null,
              revokedAt: null,
              expiresAt: { gt: new Date() },
            },
            orderBy: { createdAt: 'asc' },
          })
        : Promise.resolve([]),
      this.activeShares(workspaceId),
      this.entitlements.effective(workspace.ownerId),
    ]);
    return {
      id: workspace.id,
      name: workspace.name,
      ownerId: workspace.ownerId,
      myRole: me.role,
      memberCount: members.length,
      maxMembers: owner.entitlements.maxFamilyMembers,
      members: members.map((m) => ({
        userId: m.userId,
        name: m.user.profile?.fullName ?? '',
        email: m.user.email,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
      })),
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        expiresAt: i.expiresAt.toISOString(),
      })),
      shares: shares.map((s) => ({
        id: s.id,
        resourceType: s.resourceType,
        resourceId: s.resourceId,
        sharedBy: { userId: s.userId, name: s.user.profile?.fullName ?? '' },
        createdAt: s.createdAt.toISOString(),
      })),
    };
  }

  async rename(userId: string, workspaceId: string, name: string, client: ClientContext) {
    const me = await this.membership(userId, workspaceId);
    if (me.role !== 'OWNER') throw forbidden();
    await this.prisma.familyWorkspace.update({ where: { id: workspaceId }, data: { name } });
    await this.record('family.workspace.renamed', userId, workspaceId, client);
    return this.detail(userId, workspaceId);
  }

  /** Deleting removes every membership, invitation and share at once. */
  async remove(userId: string, workspaceId: string, client: ClientContext): Promise<void> {
    const me = await this.membership(userId, workspaceId);
    if (me.role !== 'OWNER') throw forbidden();
    await this.prisma.$transaction(async (tx) => {
      await tx.familyWorkspace.delete({ where: { id: workspaceId } });
      await this.audit.record(
        {
          action: 'family.workspace.deleted',
          userId,
          entityType: 'family_workspace',
          entityId: workspaceId,
        },
        client,
        tx,
      );
    });
  }

  // ─────────────────────────────── Invitations ───────────────────────────────

  async invite(
    userId: string,
    workspaceId: string,
    input: { email: string; role: 'ADMIN' | 'MEMBER' },
    client: ClientContext,
  ): Promise<WorkspaceDetail> {
    await this.flags.assertOn('family.workspaces');
    const me = await this.membership(userId, workspaceId);
    if (!isManager(me.role)) throw forbidden();
    if (input.role === 'ADMIN' && me.role !== 'OWNER')
      throw forbidden('Only the owner can invite admins.');
    const workspace = await this.prisma.familyWorkspace.findUniqueOrThrow({
      where: { id: workspaceId },
    });
    await this.assertSeat(workspace.ownerId, workspaceId, true);

    const existing = await this.prisma.familyMember.findFirst({
      where: { workspaceId, status: 'ACTIVE', user: { email: input.email } },
    });
    if (existing) throw conflict('This person is already a member.');

    const code = generateInviteCode();
    try {
      await this.prisma.$transaction(async (tx) => {
        const invitation = await tx.familyInvitation.create({
          data: {
            workspaceId,
            email: input.email,
            role: input.role,
            codeHash: this.hashCode(code),
            invitedById: userId,
            expiresAt: new Date(Date.now() + this.config.FAMILY_INVITE_TTL_HOURS * 3_600_000),
          },
        });
        await this.audit.record(
          {
            action: 'family.invitation.sent',
            userId,
            entityType: 'family_invitation',
            entityId: invitation.id,
            metadata: { workspaceId, role: input.role },
          },
          client,
          tx,
        );
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('This e-mail already has a pending invitation.');
      }
      throw error;
    }
    const inviter = await this.prisma.userProfile.findUnique({ where: { userId } });
    await this.email.send(
      this.inviteEmail(input.email, inviter?.fullName ?? 'A TakaWise user', workspace.name, code),
    );
    return this.detail(userId, workspaceId);
  }

  async revokeInvitation(
    userId: string,
    workspaceId: string,
    invitationId: string,
    client: ClientContext,
  ) {
    const me = await this.membership(userId, workspaceId);
    if (!isManager(me.role)) throw forbidden();
    const { count } = await this.prisma.familyInvitation.updateMany({
      where: { id: invitationId, workspaceId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw notFound();
    await this.record('family.invitation.revoked', userId, workspaceId, client, { invitationId });
    return this.detail(userId, workspaceId);
  }

  /** The invitee must be signed in with the invited e-mail address. */
  async accept(userId: string, code: string, client: ClientContext): Promise<WorkspaceDetail> {
    await this.flags.assertOn('family.workspaces');
    const invitation = await this.prisma.familyInvitation.findUnique({
      where: { codeHash: this.hashCode(code) },
      include: { workspace: true },
    });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= new Date() ||
      invitation.email !== user.email
    ) {
      throw badCode();
    }
    await this.assertSeat(invitation.workspace.ownerId, invitation.workspaceId, false);

    await this.prisma.$transaction(async (tx) => {
      await tx.familyMember.upsert({
        where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId } },
        create: { workspaceId: invitation.workspaceId, userId, role: invitation.role },
        update: { role: invitation.role, status: 'ACTIVE', joinedAt: new Date(), endedAt: null },
      });
      await tx.familyInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date(), acceptedById: userId },
      });
      await this.audit.record(
        {
          action: 'family.invitation.accepted',
          userId,
          entityType: 'family_workspace',
          entityId: invitation.workspaceId,
          metadata: { invitationId: invitation.id },
        },
        client,
        tx,
      );
    });
    return this.detail(userId, invitation.workspaceId);
  }

  // ─────────────────────────────── Members ───────────────────────────────

  /** Removing yourself is leaving. Ends the target's shares in the same transaction. */
  async removeMember(
    userId: string,
    workspaceId: string,
    targetId: string,
    client: ClientContext,
  ): Promise<void> {
    const me = await this.membership(userId, workspaceId);
    const target = await this.prisma.familyMember.findFirst({
      where: { workspaceId, userId: targetId, status: 'ACTIVE' },
    });
    if (!target) throw notFound();
    const leaving = targetId === userId;
    if (target.role === 'OWNER') {
      throw conflict(
        leaving
          ? 'The owner cannot leave; delete the workspace instead.'
          : 'The owner cannot be removed.',
      );
    }
    if (!leaving) {
      if (!isManager(me.role)) throw forbidden();
      if (target.role === 'ADMIN' && me.role !== 'OWNER')
        throw forbidden('Only the owner can remove an admin.');
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.familyMember.update({
        where: { workspaceId_userId: { workspaceId, userId: targetId } },
        data: { status: leaving ? 'LEFT' : 'REMOVED', endedAt: now },
      });
      await tx.familyShare.updateMany({
        where: { workspaceId, userId: targetId, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.audit.record(
        {
          action: leaving ? 'family.member.left' : 'family.member.removed',
          userId: targetId,
          actorId: userId,
          entityType: 'family_workspace',
          entityId: workspaceId,
        },
        client,
        tx,
      );
    });
  }

  async changeRole(
    userId: string,
    workspaceId: string,
    targetId: string,
    role: 'ADMIN' | 'MEMBER',
    client: ClientContext,
  ) {
    const me = await this.membership(userId, workspaceId);
    if (me.role !== 'OWNER') throw forbidden();
    const target = await this.prisma.familyMember.findFirst({
      where: { workspaceId, userId: targetId, status: 'ACTIVE' },
    });
    if (!target) throw notFound();
    if (target.role === 'OWNER') throw conflict('The owner role cannot be changed.');
    await this.prisma.familyMember.update({
      where: { workspaceId_userId: { workspaceId, userId: targetId } },
      data: { role },
    });
    await this.record('family.member.role_changed', userId, workspaceId, client, {
      targetId,
      role,
    });
    return this.detail(userId, workspaceId);
  }

  // ─────────────────────────────── Sharing ───────────────────────────────

  async share(
    userId: string,
    workspaceId: string,
    input: CreateShareRequest,
    client: ClientContext,
  ) {
    await this.flags.assertOn('family.workspaces');
    await this.membership(userId, workspaceId);
    // Only your own resource; 404 (not 403) so ids of others' records leak nothing.
    const owned =
      input.resourceType === 'ACCOUNT'
        ? await this.prisma.financialAccount.count({ where: { id: input.resourceId, userId } })
        : input.resourceType === 'BUDGET'
          ? await this.prisma.budget.count({ where: { id: input.resourceId, userId } })
          : await this.prisma.savingsGoal.count({ where: { id: input.resourceId, userId } });
    if (owned === 0) throw notFound();
    try {
      const share = await this.prisma.familyShare.create({
        data: {
          workspaceId,
          userId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
        },
      });
      await this.record('family.share.created', userId, workspaceId, client, {
        shareId: share.id,
        resourceType: input.resourceType,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('This is already shared with the workspace.');
      }
      throw error;
    }
    return this.detail(userId, workspaceId);
  }

  /** The sharer, or the owner (to tidy the workspace), can stop a share. */
  async unshare(userId: string, workspaceId: string, shareId: string, client: ClientContext) {
    const me = await this.membership(userId, workspaceId);
    const share = await this.prisma.familyShare.findFirst({
      where: { id: shareId, workspaceId, revokedAt: null },
    });
    if (!share) throw notFound();
    if (share.userId !== userId && me.role !== 'OWNER') throw forbidden();
    await this.prisma.familyShare.update({
      where: { id: shareId },
      data: { revokedAt: new Date() },
    });
    await this.record('family.share.revoked', userId, workspaceId, client, { shareId });
    return this.detail(userId, workspaceId);
  }

  /** Live, read-only summaries of what members chose to share. */
  async shared(userId: string, workspaceId: string): Promise<SharedResource[]> {
    await this.membership(userId, workspaceId);
    const shares = await this.activeShares(workspaceId);
    const result: SharedResource[] = [];
    for (const s of shares) {
      const sharedBy = s.user.profile?.fullName ?? '';
      if (s.resourceType === 'ACCOUNT') {
        const account = await this.prisma.financialAccount.findFirst({
          where: { id: s.resourceId, userId: s.userId, status: 'ACTIVE' },
          include: { ledgerAccount: { select: { id: true, normalBalance: true } } },
        });
        if (!account?.ledgerAccount) continue;
        const balances = await this.ledger.balances(this.prisma, [account.ledgerAccount]);
        result.push({
          resourceType: 'ACCOUNT',
          shareId: s.id,
          sharedBy,
          name: account.name,
          accountType: account.type,
          currency: account.currency,
          balance: toMoneyString(balances.get(account.ledgerAccount.id) ?? ZERO),
        });
      } else if (s.resourceType === 'BUDGET') {
        const budget = await this.budgets.get(s.userId, s.resourceId).catch(() => null);
        if (!budget) continue;
        result.push({
          resourceType: 'BUDGET',
          shareId: s.id,
          sharedBy,
          name: budget.name,
          month: budget.month,
          currency: budget.currency,
          limit: budget.overall?.limit ?? null,
          spent: budget.totalSpent,
          percentUsed: budget.overall?.percentUsed ?? null,
        });
      } else {
        const goal = await this.goals.get(s.userId, s.resourceId).catch(() => null);
        if (!goal) continue;
        // Never the linked account or the contribution notes: just progress.
        result.push({
          resourceType: 'GOAL',
          shareId: s.id,
          sharedBy,
          name: goal.name,
          currency: goal.currency,
          targetAmount: goal.targetAmount,
          saved: goal.saved,
          percent: goal.percent,
          targetDate: goal.targetDate,
        });
      }
    }
    return result;
  }

  // ─────────────────────────────── Helpers ───────────────────────────────

  /** Active membership or 404: non-members cannot even learn a workspace exists. */
  private async membership(userId: string, workspaceId: string): Promise<Membership> {
    const m = await this.prisma.familyMember.findFirst({
      where: { workspaceId, userId, status: 'ACTIVE' },
      select: { workspaceId: true, userId: true, role: true },
    });
    if (!m) throw notFound();
    return m;
  }

  /** Shares whose sharer is still an active member. */
  private activeShares(workspaceId: string) {
    return this.prisma.familyShare.findMany({
      where: {
        workspaceId,
        revokedAt: null,
        user: { familyMemberships: { some: { workspaceId, status: 'ACTIVE' } } },
      },
      include: { user: { select: { profile: { select: { fullName: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** The owner's plan must still include workspaces, and a seat must be free. */
  private async assertSeat(
    ownerId: string,
    workspaceId: string,
    countPending: boolean,
  ): Promise<void> {
    const { entitlements } = await this.entitlements.effective(ownerId);
    if (!entitlements.familyWorkspace) {
      throw planRequired(
        'familyWorkspace',
        "The workspace owner's plan no longer includes family sharing.",
      );
    }
    const [active, pending] = await Promise.all([
      this.prisma.familyMember.count({ where: { workspaceId, status: 'ACTIVE' } }),
      countPending
        ? this.prisma.familyInvitation.count({
            where: {
              workspaceId,
              acceptedAt: null,
              revokedAt: null,
              expiresAt: { gt: new Date() },
            },
          })
        : Promise.resolve(0),
    ]);
    if (active + pending >= entitlements.maxFamilyMembers) {
      throw planRequired(
        'familyMembers',
        `This workspace is limited to ${entitlements.maxFamilyMembers} members.`,
      );
    }
  }

  private hashCode(code: string): string {
    return hmacHex(this.config.AUTH_HMAC_SECRET, 'family-invite', code.toUpperCase());
  }

  private inviteEmail(to: string, inviter: string, workspace: string, code: string) {
    const days = Math.round(this.config.FAMILY_INVITE_TTL_HOURS / 24) || 1;
    return {
      to,
      subject: `${inviter} invited you to a TakaWise family workspace`,
      text:
        `${inviter} invited you to join "${workspace}" on TakaWise.\n\n` +
        `Sign in with this e-mail address, open Family, and enter the code: ${code}\n` +
        `The code expires in ${days} day(s). Joining shares nothing of yours: you choose what to share.\n\n` +
        `${inviter} আপনাকে TakaWise-এ "${workspace}" পরিবারে যোগ দিতে আমন্ত্রণ জানিয়েছেন।\n` +
        `এই ইমেইল দিয়ে সাইন ইন করে "পরিবার" পাতায় কোডটি দিন: ${code}\n` +
        `যোগ দিলে আপনার কিছুই শেয়ার হয় না; কী শেয়ার করবেন তা আপনি ঠিক করবেন।\n\n` +
        '— TakaWise\nWe will never ask for your bank or mobile-wallet PIN, password or OTP.',
    };
  }

  private record(
    action: AuditAction,
    userId: string,
    workspaceId: string,
    client: ClientContext,
    metadata?: Prisma.InputJsonObject,
  ) {
    return this.audit.record(
      { action, userId, entityType: 'family_workspace', entityId: workspaceId, metadata },
      client,
    );
  }
}

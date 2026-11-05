import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  CategoryResponse,
  CategoryType,
  CreateCategoryRequest,
  UpdateCategoryRequest,
} from '@takawise/contracts';
import { AppException } from '../../common/errors/app.exception';
import { uniqueViolation } from '../../common/errors/prisma-errors';
import type { ClientContext } from '../../common/http/client-context';
import { PrismaService } from '../../database/prisma.service';
import type { Category } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';

export function toCategoryResponse(c: Category): CategoryResponse {
  return {
    id: c.id,
    type: c.type,
    nameEn: c.nameEn,
    nameBn: c.nameBn,
    icon: c.icon,
    parentId: c.parentId,
    isSystem: c.isSystem,
    status: c.status,
  };
}

const notFound = () => new AppException('NOT_FOUND', 'Category not found.', HttpStatus.NOT_FOUND);

/**
 * CAT-01: shared, read-only system categories plus the user's own. Categories
 * are archived, never deleted, because posted history references them.
 */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    userId: string,
    filter: { type?: CategoryType; status: 'ACTIVE' | 'ARCHIVED' | 'ALL' },
  ): Promise<CategoryResponse[]> {
    const rows = await this.prisma.category.findMany({
      where: {
        OR: [{ userId: null }, { userId }],
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.status === 'ALL' ? {} : { status: filter.status }),
      },
      orderBy: [{ type: 'asc' }, { isSystem: 'desc' }, { sortOrder: 'asc' }, { nameEn: 'asc' }],
    });
    return rows.map(toCategoryResponse);
  }

  async create(
    userId: string,
    input: CreateCategoryRequest,
    client: ClientContext,
  ): Promise<CategoryResponse> {
    if (input.parentId) {
      const parent = await this.prisma.category.findFirst({
        where: { id: input.parentId, OR: [{ userId: null }, { userId }] },
      });
      if (!parent) throw notFound();
      if (parent.type !== input.type || parent.parentId !== null) {
        throw new AppException(
          'VALIDATION_ERROR',
          'Please check the submitted fields.',
          HttpStatus.BAD_REQUEST,
          [{ field: 'parentId', message: 'Choose a top-level category of the same type' }],
        );
      }
    }
    try {
      const category = await this.prisma.$transaction(async (tx) => {
        const created = await tx.category.create({
          data: {
            userId,
            type: input.type,
            nameEn: input.nameEn,
            nameBn: input.nameBn ?? input.nameEn,
            icon: input.icon ?? null,
            parentId: input.parentId ?? null,
          },
        });
        await this.audit.record(
          { action: 'category.created', userId, entityType: 'category', entityId: created.id },
          client,
          tx,
        );
        return created;
      });
      return toCategoryResponse(category);
    } catch (error) {
      throw mapDuplicate(error);
    }
  }

  async update(
    userId: string,
    id: string,
    input: UpdateCategoryRequest,
    client: ClientContext,
  ): Promise<CategoryResponse> {
    await this.findOwnCustom(userId, id);
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.category.update({
          where: { id },
          data: {
            ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
            ...(input.nameBn !== undefined ? { nameBn: input.nameBn } : {}),
            ...(input.icon !== undefined ? { icon: input.icon } : {}),
          },
        });
        await this.audit.record(
          { action: 'category.updated', userId, entityType: 'category', entityId: id },
          client,
          tx,
        );
        return row;
      });
      return toCategoryResponse(updated);
    } catch (error) {
      throw mapDuplicate(error);
    }
  }

  async setArchived(
    userId: string,
    id: string,
    archived: boolean,
    client: ClientContext,
  ): Promise<CategoryResponse> {
    const category = await this.findOwnCustom(userId, id);
    if ((category.status === 'ARCHIVED') === archived) return toCategoryResponse(category);
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.category.update({
          where: { id },
          data: archived
            ? { status: 'ARCHIVED', archivedAt: new Date() }
            : { status: 'ACTIVE', archivedAt: null },
        });
        await this.audit.record(
          {
            action: archived ? 'category.archived' : 'category.restored',
            userId,
            entityType: 'category',
            entityId: id,
          },
          client,
          tx,
        );
        return row;
      });
      return toCategoryResponse(updated);
    } catch (error) {
      throw mapDuplicate(error);
    }
  }

  /** Own custom category; system categories are visible to all but read-only. */
  private async findOwnCustom(userId: string, id: string): Promise<Category> {
    const category = await this.prisma.category.findFirst({
      where: { id, OR: [{ userId: null }, { userId }] },
    });
    if (!category) throw notFound();
    if (category.isSystem) {
      throw new AppException(
        'FORBIDDEN',
        'System categories cannot be changed.',
        HttpStatus.FORBIDDEN,
      );
    }
    return category;
  }
}

function mapDuplicate(error: unknown): unknown {
  const constraint = uniqueViolation(error);
  if (constraint && /categories_user_type_active_name|name_en/.test(constraint)) {
    return new AppException(
      'CONFLICT',
      'You already have an active category with this name.',
      HttpStatus.CONFLICT,
      [{ field: 'nameEn', message: 'Choose a different name' }],
    );
  }
  return error;
}

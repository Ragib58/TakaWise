import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createReminderRequestSchema,
  listNotificationsQuerySchema,
  listRemindersQuerySchema,
  type NotificationResponse,
  type ReminderResponse,
  updateReminderRequestSchema,
} from '@takawise/contracts';
import { createZodDto } from 'nestjs-zod';
import type { Paginated } from '../../common/envelope/paginated';
import { Client, type ClientContext } from '../../common/http/client-context';
import { type AuthContext, CurrentUser } from '../auth/auth.decorators';
import { NotificationsService } from './notifications.service';
import { RemindersService } from './reminders.service';

class CreateReminderDto extends createZodDto(createReminderRequestSchema) {}
class UpdateReminderDto extends createZodDto(updateReminderRequestSchema) {}
class ListRemindersQueryDto extends createZodDto(listRemindersQuerySchema) {}
class ListNotificationsQueryDto extends createZodDto(listNotificationsQuerySchema) {}

@ApiTags('reminders')
@ApiBearerAuth()
@Controller('reminders')
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get()
  list(
    @CurrentUser() auth: AuthContext,
    @Query() query: ListRemindersQueryDto,
  ): Promise<Paginated<ReminderResponse>> {
    return this.reminders.list(auth.userId, query);
  }

  @Post()
  create(
    @CurrentUser() auth: AuthContext,
    @Body() body: CreateReminderDto,
    @Client() client: ClientContext,
  ): Promise<ReminderResponse> {
    return this.reminders.create(auth.userId, body, client);
  }

  @Get(':id')
  get(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReminderResponse> {
    return this.reminders.get(auth.userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateReminderDto,
    @Client() client: ClientContext,
  ): Promise<ReminderResponse> {
    return this.reminders.update(auth.userId, id, body, client);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Client() client: ClientContext,
  ): Promise<ReminderResponse> {
    return this.reminders.complete(auth.userId, id, client);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Client() client: ClientContext,
  ): Promise<ReminderResponse> {
    return this.reminders.cancel(auth.userId, id, client);
  }
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() auth: AuthContext,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<Paginated<NotificationResponse>> {
    return this.notifications.list(auth.userId, query);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() auth: AuthContext): Promise<{ unread: number }> {
    return this.notifications.unreadCount(auth.userId);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  markAllRead(@CurrentUser() auth: AuthContext): Promise<{ updated: number }> {
    return this.notifications.markAllRead(auth.userId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  markRead(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationResponse> {
    return this.notifications.markRead(auth.userId, id);
  }
}

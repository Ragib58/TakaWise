import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  createTicketRequestSchema,
  ticketMessageRequestSchema,
  type TicketResponse,
} from '@takawise/contracts';
import { createZodDto } from 'nestjs-zod';
import { Client, type ClientContext } from '../../../common/http/client-context';
import { type AuthContext, CurrentUser } from '../../auth/auth.decorators';
import { SupportService } from './support.service';

class CreateTicketDto extends createZodDto(createTicketRequestSchema) {}
class MessageDto extends createZodDto(ticketMessageRequestSchema) {}

@ApiTags('support')
@ApiBearerAuth()
@Controller('support/tickets')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  create(
    @CurrentUser() auth: AuthContext,
    @Body() body: CreateTicketDto,
    @Client() client: ClientContext,
  ): Promise<TicketResponse> {
    return this.support.create(auth.userId, body, client);
  }

  @Get()
  list(@CurrentUser() auth: AuthContext): Promise<TicketResponse[]> {
    return this.support.listMine(auth.userId);
  }

  @Get(':id')
  get(
    @CurrentUser() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<TicketResponse> {
    return this.support.getMine(auth.userId, id);
  }

  @Post(':id/messages')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  reply(
    @CurrentUser() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: MessageDto,
    @Client() client: ClientContext,
  ): Promise<TicketResponse> {
    return this.support.replyAsUser(auth.userId, id, body.body, client);
  }
}

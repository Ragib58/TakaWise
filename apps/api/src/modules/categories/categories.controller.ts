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
  type CategoryResponse,
  createCategoryRequestSchema,
  listCategoriesQuerySchema,
  updateCategoryRequestSchema,
} from '@takawise/contracts';
import { createZodDto } from 'nestjs-zod';
import { Client, type ClientContext } from '../../common/http/client-context';
import { type AuthContext, CurrentUser } from '../auth/auth.decorators';
import { CategoriesService } from './categories.service';

class ListCategoriesQueryDto extends createZodDto(listCategoriesQuerySchema) {}
class CreateCategoryDto extends createZodDto(createCategoryRequestSchema) {}
class UpdateCategoryDto extends createZodDto(updateCategoryRequestSchema) {}

@ApiTags('categories')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list(
    @CurrentUser() auth: AuthContext,
    @Query() query: ListCategoriesQueryDto,
  ): Promise<CategoryResponse[]> {
    return this.categories.list(auth.userId, query);
  }

  @Post()
  create(
    @CurrentUser() auth: AuthContext,
    @Body() body: CreateCategoryDto,
    @Client() client: ClientContext,
  ): Promise<CategoryResponse> {
    return this.categories.create(auth.userId, body, client);
  }

  @Patch(':id')
  update(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCategoryDto,
    @Client() client: ClientContext,
  ): Promise<CategoryResponse> {
    return this.categories.update(auth.userId, id, body, client);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Client() client: ClientContext,
  ): Promise<CategoryResponse> {
    return this.categories.setArchived(auth.userId, id, true, client);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Client() client: ClientContext,
  ): Promise<CategoryResponse> {
    return this.categories.setArchived(auth.userId, id, false, client);
  }
}

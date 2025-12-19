import { PostUserDto, PutUserDto, toGetUserDto } from '@edanalytics/models';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotImplementedException,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaClient } from '@prisma/client';
import { PRISMA_APP_USER } from '../database';
import { throwNotFound } from '../utils';

@ApiTags('User')
@Controller()
export class UsersController {
  constructor(@Inject(PRISMA_APP_USER) private prisma: PrismaClient) {}

  @Post()
  async create(@Body() createUserDto: PostUserDto) {
    // for now, all user records are created on the fly on login
    return new NotImplementedException();
  }

  @Get()
  async findAll() {
    return new NotImplementedException();
  }

  @Get(':userId')
  async findOne(
    @Param('userId', new ParseIntPipe())
    userId: number
  ) {
    return new NotImplementedException();
  }

  @Put(':userId')
  async update(
    @Param('userId', new ParseIntPipe())
    userId: number,
    @Body() updateUserDto: PutUserDto
  ) {
    return new NotImplementedException();
  }

  @Delete(':userId')
  async remove(
    @Param('userId', new ParseIntPipe())
    userId: number
  ) {
    return new NotImplementedException();
  }
}

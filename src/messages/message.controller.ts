import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MessageService } from './message.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { Role } from '@/common/constants';

@Controller('api/messages')
export class MessagesController {
  constructor(private readonly messages: MessageService) {}

  // Public: any visitor can send a general message to the team.
  @Post()
  async create(@Body() dto: CreateMessageDto) {
    const message = await this.messages.create(dto);
    return {
      ok: true,
      message: 'We received your inquiry.',
      data: message,
    };
  }

  // Staff-only: browse submitted messages.
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.UNDERWRITER)
  async list(@Query('subject') subject?: string, @Query('date') date?: string) {
    return this.messages.findAll({ subject, date });
  }

  // Staff-only: fetch a single message by id.
  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.UNDERWRITER)
  async one(@Param('id') id: string) {
    return this.messages.findOne(id);
  }
}

import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';

import { Op } from 'sequelize';
import { CreateMessageDto } from './dto/create-message.dto';
import { Message } from './models/message.entity';

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(@InjectModel(Message) private readonly model: typeof Message) {}

  async create(dto: CreateMessageDto): Promise<Message> {
    try {
      const message = await this.model.create({
        full_name: dto.full_name,
        email: dto.email,
        number: dto.number,
        subject: dto.subject,
        message: dto.message,
      } as Partial<Message> as Message);

      return message;
    } catch (err) {
      this.logger.error('Failed to create message', err as Error);
      throw new InternalServerErrorException(
        'Could not submit your inquiry. Please try again.',
      );
    }
  }

  async findAll(filters: { subject?: string; date?: string }) {
    try {
      const where: Record<string, unknown> = {};
      if (filters.subject)
        where.subject = { [Op.like]: `%${filters.subject}%` };

      if (filters.date) {
        const startOfDay = new Date(filters.date);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(filters.date);
        endOfDay.setHours(23, 59, 59, 999);

        where.created_at = {
          [Op.between]: [startOfDay, endOfDay],
        };
      }

      return await this.model.findAll({
        where,
        order: [['created_at', 'DESC']],
      });
    } catch (err) {
      this.logger.error('Failed to list messages', err as Error);
      throw new InternalServerErrorException('Could not load messages.');
    }
  }

  async findOne(id: string): Promise<Message> {
    try {
      const message = await this.model.findByPk(id);
      if (!message) throw new NotFoundException('Message not found.');
      return message;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('Failed to fetch message', err as Error);
      throw new InternalServerErrorException('Could not load message.');
    }
  }
}

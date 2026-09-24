import { Module } from '@nestjs/common';
import { EventbriteService } from './eventbrite.service';

@Module({ providers: [EventbriteService], exports: [EventbriteService] })
export class EventbriteModule {}

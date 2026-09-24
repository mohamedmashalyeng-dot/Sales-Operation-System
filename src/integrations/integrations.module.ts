import { Module } from '@nestjs/common';
import { GmailModule } from './gmail/gmail.module';
import { EventbriteModule } from './eventbrite/eventbrite.module';

@Module({ imports: [GmailModule, EventbriteModule] })
export class IntegrationsModule {}

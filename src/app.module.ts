import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { LeadsModule } from './leads/leads.module';
import { TasksModule } from './tasks/tasks.module';
import { EmailsModule } from './emails/emails.module';
import { EventsModule } from './events/events.module';
import { ApplicationsModule } from './applications/applications.module';
import { ProgrammesModule } from './programmes/programmes.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    UsersModule,
    LeadsModule,
    TasksModule,
    EmailsModule,
    EventsModule,
    ApplicationsModule,
    ProgrammesModule,
    IntegrationsModule
  ],
  controllers: [HealthController]
})
export class AppModule {}

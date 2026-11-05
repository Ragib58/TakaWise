import { Global, Module } from '@nestjs/common';
import { BudgetsController } from './budgets/budgets.controller';
import { BudgetsService } from './budgets/budgets.service';
import { CategoriesController } from './categories/categories.controller';
import { CategoriesService } from './categories/categories.service';
import { GoalsController } from './goals/goals.controller';
import { GoalsService } from './goals/goals.service';
import { BackgroundJobsService } from './jobs/background-jobs.service';
import { RedisHealth } from './jobs/redis-health.service';
import { NotificationsService } from './reminders/notifications.service';
import { ReminderDispatcher } from './reminders/reminder-dispatcher.service';
import { NotificationsController, RemindersController } from './reminders/reminders.controller';
import { RemindersService } from './reminders/reminders.service';

/** Phase 5: categories, budgets, savings goals, reminders, notifications and background jobs. */
@Global()
@Module({
  controllers: [
    CategoriesController,
    BudgetsController,
    GoalsController,
    RemindersController,
    NotificationsController,
  ],
  providers: [
    CategoriesService,
    BudgetsService,
    GoalsService,
    RemindersService,
    NotificationsService,
    ReminderDispatcher,
    BackgroundJobsService,
    RedisHealth,
  ],
  exports: [RedisHealth, ReminderDispatcher, BackgroundJobsService],
})
export class PlanningModule {}

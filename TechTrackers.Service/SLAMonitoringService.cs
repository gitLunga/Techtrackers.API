using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using TechTrackers.Data;
using TechTrackers.Data.Model;

namespace TechTrackers.Service
{
    public class SLAMonitoringService : BackgroundService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<SLAMonitoringService> _logger;

        public SLAMonitoringService(IServiceScopeFactory scopeFactory, ILogger<SLAMonitoringService> logger)
        {
            _scopeFactory = scopeFactory;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                using (var scope = _scopeFactory.CreateScope())
                {
                    var dbContext = scope.ServiceProvider.GetRequiredService<TechTrackersDbContext>();
                    var currentTime = DateTime.Now;

                    // Check for logs that need to be escalated after response due time elapses
                    var logsToEscalateResponse = dbContext.Logs
                        .Where(l => l.ResponseDue <= currentTime && l.LogStatus == "PENDING")
                        .ToList();

                    foreach (var log in logsToEscalateResponse)
                    {
                        // Escalate due to missed response time and set ResolutionDue countdown
                        log.EscalationLevel = 1;
                        log.LogStatus = "ESCALATED";
                        log.ResolutionDue = currentTime.AddMinutes(log.SLA?.ResolutionTimeframe ?? 2); // Start resolution countdown

                        // Notify technician of escalation
                        await SendNotification(dbContext, log.TechnicianId, log.LogId, "INFORMATION", "Escalated to Level 1: Task response time has elapsed.");

                        _logger.LogInformation($"Escalated Log ID: {log.LogId} to Level 1 due to response time elapse.");
                    }

                    // Monitor logs in resolution phase and manage escalation levels
                    var resolutionLogs = dbContext.Logs
                        .Where(l => l.LogStatus == "ESCALATED" && l.ResolutionDue.HasValue && l.EscalationLevel < 3)
                        .ToList();

                    foreach (var log in resolutionLogs)
                    {
                        var totalResolutionTime = (log.ResolutionDue.Value - log.AssignedAt).TotalMinutes;
                        var elapsedResolutionTime = (currentTime - log.AssignedAt).TotalMinutes;
                        var newEscalationLevel = log.EscalationLevel;

                        if (elapsedResolutionTime >= totalResolutionTime)
                        {
                            newEscalationLevel = 3;  // 100% elapsed
                            await SendNotification(dbContext, log.TechnicianId, log.LogId, "ALERT", "Escalated to Level 3: Task overdue!");
                            await SendNotification(dbContext, log.AssignedBy, log.LogId, "ALERT", "Escalated to Level 3: Technician overdue.");
                        }
                        else if (elapsedResolutionTime >= totalResolutionTime * 0.5 && log.EscalationLevel < 2)
                        {
                            newEscalationLevel = 2;  // 50% elapsed
                            await SendNotification(dbContext, log.TechnicianId, log.LogId, "WARNING", "Escalated to Level 2: Task pending completion.");
                        }
                        else if (elapsedResolutionTime >= totalResolutionTime * 0.25 && log.EscalationLevel < 1)
                        {
                            newEscalationLevel = 1;  // 25% elapsed
                            await SendNotification(dbContext, log.TechnicianId, log.LogId, "INFORMATION", "Escalated to Level 1: Please progress your task.");
                        }

                        log.EscalationLevel = newEscalationLevel;
                        _logger.LogInformation($"Log ID: {log.LogId} updated to Escalation Level {log.EscalationLevel}");
                    }

                    await dbContext.SaveChangesAsync();
                }

                // Run every 5 minutes to check SLA and escalation conditions
                await Task.Delay(TimeSpan.FromMinutes(0.1), stoppingToken);
            }
        }

        private async Task SendNotification(TechTrackersDbContext dbContext, int? userId, int logId, string type, string message)
        {
            if (userId.HasValue)
            {
                var notification = new Notification
                {
                    UserId = userId.Value,
                    LogId = logId,
                    Type = type,
                    Message = message,
                    Timestamp = DateTime.Now
                };
                dbContext.Notifications.Add(notification);
                await dbContext.SaveChangesAsync();
            }
        }
    }

}

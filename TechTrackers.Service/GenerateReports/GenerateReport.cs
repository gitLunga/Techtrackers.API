using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TechTrackers.Data;
using TechTrackers.Data.Model.dto.ReportDto;

namespace TechTrackers.Service.GenerateReports
{
    public class GenerateReport : IGenerateReport
    {

        private readonly TechTrackersDbContext _dbContext;

        public GenerateReport(TechTrackersDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        public async Task<IEnumerable<IssueReportDto>> GetIssueByStatusReport()
        {
            var logs = await _dbContext.Logs
                 .Include(l => l.Technician)
                 .Select(log => new IssueReportDto
                 {
                     LogId = log.LogId,
                     IssueTitle = log.IssueTitle,
                     Priority = log.Priority,
                     Technician = log.Technician != null ? $"{log.Technician.Initials} {log.Technician.Surname}" : "Unassigned",
                     Status = log.LogStatus ?? "Pending",
                     DateCreated = log.CreatedAt,
                     DueDate = log.ResolutionDue,
                   //  DateClosed = log.DateClosed
                 })
                 .ToListAsync();

            return logs;
        }

        public async Task<IssueStatusCountDto> GetIssueStatusCount()
        {
            var statusCounts = await _dbContext.Logs
                 .GroupBy(l => l.LogStatus)
                 .Select(group => new { Status = group.Key, Count = group.Count() })
                 .ToListAsync();

            return new IssueStatusCountDto
            {
                Open = statusCounts.FirstOrDefault(s => s.Status == "PENDING")?.Count ?? 0,
                InProgress = statusCounts.FirstOrDefault(s => s.Status == "INPROGRESS")?.Count ?? 0,
                Completed = statusCounts.FirstOrDefault(s => s.Status == "RESOLVED")?.Count ?? 0,
                Escalated = statusCounts.FirstOrDefault(s => s.Status == "ESCALATED")?.Count ?? 0,
                OnHold = statusCounts.FirstOrDefault(s => s.Status == "On Hold")?.Count ?? 0
            };
        }
    }
}

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
    public class TechPerformanceReport : ITechPerformanceReport
    {
        private readonly TechTrackersDbContext _dbContext;

        public TechPerformanceReport(TechTrackersDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        public async Task<List<TechPerformanceReportDto>> GetTechnicianPerformanceReport()
        {
            var technicians = await _dbContext.Users
                .Where(u => u.RoleId == 3) // Only fetch technicians
                .Select(t => new
                {
                    TechnicianName = $"{t.Surname} {t.Initials}",
                    AssignedIssues = _dbContext.Logs.Count(l => l.TechnicianId == t.UserId),
                    ResolvedIssues = _dbContext.Logs.Count(l => l.TechnicianId == t.UserId && l.LogStatus == "RESOLVED"),
                    PendingIssues = _dbContext.Logs.Count(l => l.TechnicianId == t.UserId && (l.LogStatus == "INPROGRESS" || l.LogStatus == "PENDING")),

                    // Fetch resolution times as TimeSpan?
                    ResolutionTimes = _dbContext.Logs
                        .Where(l => l.TechnicianId == t.UserId && l.ResolutionDue != null && l.AssignedAt != null)
                        .Select(l => (TimeSpan?)(l.ResolutionDue - l.AssignedAt)) // ✅ Ensure nullable TimeSpan
                        .ToList(),

                    // Average rating from feedbacks linked to logs
                    PerformanceRating = _dbContext.Feedbacks
                        .Where(f => _dbContext.Logs.Any(l => l.LogId == f.LogId && l.TechnicianId == t.UserId))
                        .Average(f => (double?)f.Rating) ?? 0 // Out of 5
                })
                .ToListAsync(); // Execute the query first

            // **Convert fetched data**
            return technicians.Select(t => new TechPerformanceReportDto
            {
                TechnicianName = t.TechnicianName,
                AssignedIssues = t.AssignedIssues,
                ResolvedIssues = t.ResolvedIssues,
                PendingIssues = t.PendingIssues,

                // Calculate avg resolution time in HOURS (whole number)
                AvgResolutionTime = t.ResolutionTimes.Any()
                    ? (int)t.ResolutionTimes.Average(rt => rt.HasValue ? rt.Value.TotalHours : 0) // ✅ Fix applied
                    : 0,

                PerformanceRating = Math.Round(t.PerformanceRating, 1) // Show as "3.8 / 5"
            }).ToList();
        }








    }
}

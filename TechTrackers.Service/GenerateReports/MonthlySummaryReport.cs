using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TechTrackers.Data;
using TechTrackers.Data.Model.dto.ReportDto;

namespace TechTrackers.Service.GenerateReports
{
    public class MonthlySummaryReport: IMonthlySummaryReport
    {

        private readonly TechTrackersDbContext _dbContext;

        public MonthlySummaryReport(TechTrackersDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        public async Task<List<MonthlyReportDto>> GetMonthlySummaryReport()
        {
            var monthlyReports = await _dbContext.Logs
                .GroupBy(l => new { l.CreatedAt.Year, l.CreatedAt.Month }) // Group by month
                .Select(group => new MonthlyReportDto
                {
                    Month = $"{group.Key.Year} {CultureInfo.CurrentCulture.DateTimeFormat.GetMonthName(group.Key.Month)}",
                    TotalIssues = group.Count(),
                    IssuesClosed = group.Count(l => l.LogStatus == "RESOLVED"),
                    IssuesOpen = group.Count(l => l.LogStatus == "Open" || l.LogStatus == "INPROGRESS" || l.LogStatus == "PENDING"),
                    AvgResolutionTime = $"{group.Average(l => EF.Functions.DateDiffDay(l.CreatedAt, l.ResolutionDue))} days"
                })
                .ToListAsync();

            return monthlyReports;
        }
    }

}


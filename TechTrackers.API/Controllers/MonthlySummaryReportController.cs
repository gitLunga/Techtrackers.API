using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using TechTrackers.Data.Model.dto.ReportDto;
using TechTrackers.Service.GenerateReports;

namespace TechTrackers.API.Controllers
{
    [Route("api/[controller]/[action]")]
    [EnableCors("corspolicy")]
    public class MonthlySummaryReportController : Controller
    {
        private readonly IMonthlySummaryReport _monthlySummaryReportService;

        public MonthlySummaryReportController(IMonthlySummaryReport monthlySummaryReportService)
        {
            _monthlySummaryReportService = monthlySummaryReportService;
        }

        [HttpGet]
        public async Task<ActionResult<List<MonthlyReportDto>>> GetMonthlySummaryReport()
        {
            var report = await _monthlySummaryReportService.GetMonthlySummaryReport();
            return Ok(report);
        }

    }
}

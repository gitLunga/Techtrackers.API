using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using TechTrackers.Data.Model.dto.ReportDto;
using TechTrackers.Service.GenerateReports;

namespace TechTrackers.API.Controllers
{
    [Route("api/[controller]/[action]")]
    [EnableCors("corspolicy")]
    public class GenerateReportController : Controller
    {
        private readonly IGenerateReport _generateReport;

        public GenerateReportController(IGenerateReport generateReport)
        {
            _generateReport = generateReport;
        }

        // GET: api/GenerateReport/GetIssueByStatusReport
        [HttpGet]
        public async Task<ActionResult<IEnumerable<IssueReportDto>>> GetIssueByStatusReport()
        {
            var reports = await _generateReport.GetIssueByStatusReport();
            return Ok(reports);
        }

        // GET: api/GenerateReport/GetIssueStatusCount
        [HttpGet]
        public async Task<ActionResult<IssueStatusCountDto>> GetIssueStatusCount()
        {
            var statusCount = await _generateReport.GetIssueStatusCount();
            return Ok(statusCount);
        }
    }
}

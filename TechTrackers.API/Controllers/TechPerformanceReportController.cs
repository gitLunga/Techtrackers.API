using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using TechTrackers.Data.Model.dto.ReportDto;
using TechTrackers.Service.GenerateReports;

namespace TechTrackers.API.Controllers
{
    [Route("api/[controller]/[action]")]
    [EnableCors("corspolicy")]
    public class TechPerformanceReportController : Controller
    {
        private readonly ITechPerformanceReport _techPerformanceReport;

        public TechPerformanceReportController(ITechPerformanceReport techPerformanceReport)
        {
            _techPerformanceReport = techPerformanceReport;
        }

        [HttpGet]
        public async Task<ActionResult<List<TechPerformanceReportDto>>> GetTechnicianPerformanceReport()
        {
            var report = await _techPerformanceReport.GetTechnicianPerformanceReport();
            return Ok(report);
        }

    }
}

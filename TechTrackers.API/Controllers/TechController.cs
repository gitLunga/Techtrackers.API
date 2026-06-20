using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using TechTrackers.Service.TechnicianServicess;

namespace TechTrackers.API.Controllers
{
    [Route("api/[controller]/[action]")]
    [EnableCors("corspolicy")]
    public class TechController : Controller
    {

        private readonly ITechnicianService _techService;

        public TechController(ITechnicianService techService)
        {
            _techService = techService;
        }

        /* [HttpGet("{technicianId}/logCounts")]
         public async Task<IActionResult> GetLogCountsByStatus(int technicianId)
         {
             var response = await _techService.GetTechnicianLogStatsAsync(technicianId);

             if (!response.IsSuccess)
             {
                 return BadRequest(response); // Return a 400 error with the response wrapper
             }

             return Ok(response); // Return 200 success with the response wrapper
         }*/
        /*
                [HttpGet("technician/{technicianId}/logStats")]
                public async Task<IActionResult> GetTechnicianLogStats(int technicianId)
                {
                    var response = await _techService.GetTechnicianLogStatsAsync(technicianId);

                    if (!response.IsSuccess)
                    {
                        return BadRequest(response); // Return a 400 response with the error message
                    }

                    return Ok(response); // Return a 200 response with log statistics
                }*/


        [HttpGet("{technicianId}/countResolved")]
        public async Task<IActionResult> CountResolvedLogs(int technicianId)
        {
            var count = await _techService.GetTechnicianLogCountAsync(technicianId, "RESOLVED");
            return Ok(count);
        }

        [HttpGet("{technicianId}/countInProgress")]
        public async Task<IActionResult> CountInProgressLogs(int technicianId)
        {
            var count = await _techService.GetTechnicianLogCountAsync(technicianId, "INPROGRESS");
            return Ok(count);
        }

        [HttpGet("{technicianId}/countOnHold")]
        public async Task<IActionResult> CountOnHoldLogs(int technicianId)
        {
            var count = await _techService.GetTechnicianLogCountAsync(technicianId, "ONHOLD");
            return Ok(count);
        }

        [HttpGet("{technicianId}/countPending")]
        public async Task<IActionResult> CountPendingLogs(int technicianId)
        {
            var count = await _techService.GetTechnicianLogCountAsync(technicianId, "PENDING");
            return Ok(count);
        }
    }
}

using Microsoft.AspNetCore.Mvc;
using System.Collections.Generic;
using System.Threading.Tasks;
using TechTrackers.Data.Model;
using TechTrackers.Service;

namespace TechTrackers.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class TechnicianController : ControllerBase
    {
        private readonly AssignTechnicianService _technicianService;

        public TechnicianController(AssignTechnicianService technicianService)
        {
            _technicianService = technicianService;
        }

        [HttpGet("GetAll")]
        public async Task<ActionResult<IEnumerable<User>>> GetAllTechnicians()
        {
            try
            {
                var technicians = await _technicianService.GetAllTechniciansAsync();
                if (technicians == null)
                {
                    return NotFound(new { message = "No technicians found with RoleId = 3" });
                }
                return Ok(technicians);
            }
            catch (Exception ex)
            {
                // Log or handle exceptions here if needed
                return StatusCode(500, new { message = "An internal server error occurred." });
            }
        }
    }
}

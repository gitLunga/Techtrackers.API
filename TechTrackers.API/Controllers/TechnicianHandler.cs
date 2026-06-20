using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using TechTrackers.Data.Model.dto;
using TechTrackers.Service;

namespace TechTrackers.API.Controllers
{
    [Route("api/[controller]/[action]")]
    [EnableCors("corspolicy")]
    [ApiController]
    public class TechnicianHandler : ControllerBase
    {
        private readonly TechnicianService _technicianservice;

        public TechnicianHandler(TechnicianService technicianService)
        {
            _technicianservice = technicianService;
        }

        [HttpPost("add")]
        public IActionResult AddTechnician([FromBody] TechnicianDto technicianDto)
        {
            if (!ModelState.IsValid)
                return BadRequest(ModelState);

            try
            {
                _technicianservice.AddTechnician(technicianDto);
                return Ok(new { message = "Technician added successfully" });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { error = ex.Message });
            }
        }

        [HttpGet]
        public IActionResult GetTechnicians()
        {
            try
            {
                var technicians = _technicianservice.GetAllTechnicians();
                return Ok(technicians);
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { error = ex.Message });
            }
        }

        [HttpGet("{id}")]
        public IActionResult GetTechnician(int id)
        {
            try
            {
                // Call the service method to retrieve the Technician by ID
                var technician = _technicianservice.GetTechnicianById(id);

                // Return a 404 status if the Technician is not found
                if (technician == null)
                    return NotFound(new { message = "Technician not found." });

                // Return the Technician details with a 200 status
                return Ok(technician);
            }
            catch (Exception ex)
            {
                // Return a 500 status for server errors
                return StatusCode(500, new { error = ex.Message });
            }
        }
        [HttpPut("{id}")]
        public IActionResult UpdateTechnician(int id, [FromBody] TechnicianDto technicianDto)
        {
            if (!ModelState.IsValid)
                return BadRequest(ModelState);

            try
            {
                _technicianservice.UpdateTechnician(id, technicianDto);
                return Ok(new { message = "Technician updated successfully" });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { error = ex.Message });
            }
        }

        [HttpDelete("{id}")]
        public IActionResult DeleteTechnician(int id)
        {
            try
            {
                _technicianservice.DeleteTechnician(id);
                return Ok(new { message = "Technician deleted successfully" });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { error = ex.Message });
            }
        }
    }
}

using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using TechTrackers.Data.Model;
using TechTrackers.Data.Model.dto;
using TechTrackers.Services;

namespace TechTrackers.API.Controllers
{
    [Route("api/[controller]/[action]")]
    [EnableCors("corspolicy")]
    public class CRUDDepartmentController : Controller
    {
        private readonly IDepartmentService _departmentService;

        public CRUDDepartmentController(IDepartmentService departmentService)
        {
            _departmentService = departmentService;
        }

        [HttpGet]
        public async Task<IActionResult> GetAllDepartments()
        {
            var departments = await _departmentService.GetAllDepartmentsAsync();
            return Ok(departments);
        }

        [HttpGet("{id}")]
        public async Task<IActionResult> GetDepartmentById(int id)
        {
            var department = await _departmentService.GetDepartmentByIdAsync(id);
            if (department == null)
                return NotFound();

            return Ok(department);
        }

        [HttpPost]
        public async Task<IActionResult> AddDepartment([FromBody] DepartmentDTO departmentDto)
        {
            if (!ModelState.IsValid)
                return BadRequest(ModelState);

            var isAdded = await _departmentService.AddDepartmentAsync(departmentDto);
            if (!isAdded)
                return BadRequest("Department could not be added.");

            return CreatedAtAction(nameof(GetDepartmentById), new { id = departmentDto.DepartmentId }, departmentDto);
        }

        [HttpPut("{id}")]
        public async Task<IActionResult> UpdateDepartment(int id, [FromBody] DepartmentDTO departmentDto)
        {
            if (!ModelState.IsValid || id != departmentDto.DepartmentId)
                return BadRequest(ModelState);

            var isUpdated = await _departmentService.UpdateDepartmentAsync(departmentDto);
            if (!isUpdated)
                return NotFound();

            return NoContent();
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteDepartment(int id)
        {
            var isDeleted = await _departmentService.DeleteDepartmentAsync(id);
            if (!isDeleted)
                return NotFound();

            return NoContent();
        }
    }
}

using TechTrackers.Data.Model;
using System.Collections.Generic;
using System.Threading.Tasks;
using TechTrackers.Data.Model.dto;

namespace TechTrackers.Services
{
    public interface IDepartmentService
    {
        Task<IEnumerable<DepartmentDTO>> GetAllDepartmentsAsync();
        Task<DepartmentDTO?> GetDepartmentByIdAsync(int departmentId);
        Task<bool> AddDepartmentAsync(DepartmentDTO department);
        Task<bool> UpdateDepartmentAsync(DepartmentDTO department);
        Task<bool> DeleteDepartmentAsync(int departmentId);
    }
}

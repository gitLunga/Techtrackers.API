using TechTrackers.Data.Model;
using TechTrackers.Data.Model; // Assuming DbContext is here
using Microsoft.EntityFrameworkCore;
using System.Collections.Generic;
using System.Threading.Tasks;
using System;
using TechTrackers.Data;
using TechTrackers.Data.Model.dto;

namespace TechTrackers.Services
{
    public class DepartmentService : IDepartmentService
    {
        private readonly TechTrackersDbContext _dbContext;

        public DepartmentService(TechTrackersDbContext context)
        {
            _dbContext = context;
        }

        public async Task<IEnumerable<DepartmentDTO>> GetAllDepartmentsAsync()
        {
            var departments = await _dbContext.Departments.Include(d => d.Users).ToListAsync();
            return departments.Select(d => new DepartmentDTO
            {
                DepartmentId = d.DepartmentId,
                DepartmentName = d.DepartmentName,
             
            });
        }

        public async Task<DepartmentDTO?> GetDepartmentByIdAsync(int departmentId)
        {
            var department = await _dbContext.Departments
                .Include(d => d.Users)
                .FirstOrDefaultAsync(d => d.DepartmentId == departmentId);

            if (department == null) return null;

            return new DepartmentDTO
            {
                DepartmentId = department.DepartmentId,
                DepartmentName = department.DepartmentName,
            };
        }

        public async Task<bool> AddDepartmentAsync(DepartmentDTO dto)
        {
            if (dto == null) return false;

            var department = new Department
            {
                DepartmentName = dto.DepartmentName,
            };

            _dbContext.Departments.Add(department);
            return await _dbContext.SaveChangesAsync() > 0;
        }

        public async Task<bool> UpdateDepartmentAsync(DepartmentDTO dto)
        {
            if (dto == null) return false;

            var department = await _dbContext.Departments
                .Include(d => d.Users)
                .FirstOrDefaultAsync(d => d.DepartmentId == dto.DepartmentId);

            if (department == null) return false;

            department.DepartmentName = dto.DepartmentName;

            // Update Users if necessary
           

            _dbContext.Departments.Update(department);
            return await _dbContext.SaveChangesAsync() > 0;
        }

        public async Task<bool> DeleteDepartmentAsync(int departmentId)
        {
            var department = await _dbContext.Departments.FindAsync(departmentId);
            if (department == null) return false;

            _dbContext.Departments.Remove(department);
            return await _dbContext.SaveChangesAsync() > 0;
        }
    }
}

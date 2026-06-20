using Microsoft.EntityFrameworkCore;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using TechTrackers.Data;
using TechTrackers.Data.Model;
using TechTrackers.Data.Model.dto;

namespace TechTrackers.Service
{
    public class AssignTechnicianService
    {
        private readonly TechTrackersDbContext _dbContext;

        public AssignTechnicianService(TechTrackersDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        // Method to fetch all technicians with RoleId = 3
        public async Task<IEnumerable<AssignLogTechnicianDto>> GetAllTechniciansAsync()
        {
            return await _dbContext.Users
                .Include(u => u.UserRoles)
                .Where(u => u.UserRoles.Any(r => r.RoleId == 3))
                .Select(u => new AssignLogTechnicianDto
                {
                    UserId = u.UserId,
                    Name = u.Surname,
                    Email = u.EmailAddress,
                    RoleName = u.UserRoles.FirstOrDefault(r => r.RoleId == 3) != null
                        ? u.UserRoles.FirstOrDefault(r => r.RoleId == 3).Role.RoleName
                        : null
                })
                .ToListAsync(); // Ensure ToListAsync() is here to execute the query asynchronously
        }

        public async Task NotifyTechnicianAssignmentAsync(int assignedTechnicianId, Log log, LogDto logDto, User adminUser)
        {
            // Notify the technician about the assignment
            var assignedTechnician = await _dbContext.Users
                .FirstOrDefaultAsync(u => u.UserId == assignedTechnicianId);

            if (assignedTechnician != null)
            {
                var notificationForTechnician = new Notification
                {
                    LogId = log.LogId,
                    UserId = assignedTechnician.UserId, // Notify the assigned technician
                    Message = $"Admin ({adminUser.Surname} {adminUser.Initials}) has assigned you to the issue titled: '{logDto.Issue_Title}'.",
                    Type = "ALERT",
                    Timestamp = DateTime.Now,
                    ReadStatus = false
                };

                await _dbContext.Notifications.AddAsync(notificationForTechnician);
                await _dbContext.SaveChangesAsync();
            }
        }

    }
}

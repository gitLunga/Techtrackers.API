using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TechTrackers.Data;
using TechTrackers.Data.Model.dto;

namespace TechTrackers.Service.TechnicianServicess
{
    public class TechnicianServices: ITechnicianService
    {
        private readonly TechTrackersDbContext _context;

        public TechnicianServices(TechTrackersDbContext context)
        {
            _context = context;
        }

        public async Task<int> GetTechnicianLogCountAsync(int technicianId, string status)
        {
            // Check if technician exists
            var technicianExists = await _context.Users
                .AnyAsync(u => u.UserId == technicianId && u.Role.RoleName == "Technician");

            if (!technicianExists)
            {
                return 0; // Return 0 if the technician does not exist
            }

            // Count logs for the specified status
            return await _context.Logs
                .Where(log => log.TechnicianId == technicianId && log.LogStatus == status)
                .CountAsync();
        }
    }
}

using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TechTrackers.Data;
using TechTrackers.Data.Model.dto;
using TechTrackers.Data.Model;

namespace TechTrackers.Service
{
    public class ExternalTechnicianService
    {
        private readonly TechTrackersDbContext _context;

        public ExternalTechnicianService(TechTrackersDbContext context)
        {
            _context = context;
        }


        public void AddExternalTechnician(TechnicianDto technicianDto)
        {
            // Hash the password (implement a password hashing utility if not available)
            var hashedPassword = HashPassword(technicianDto.Password);

            // Create the User entity
            var user = new User
            {
                Surname = technicianDto.Surname,
                Initials = technicianDto.Initials,
                EmailAddress = technicianDto.EmailAddress,
                PasswordHash = hashedPassword,
                DepartmentId = technicianDto.DepartmentId,
                RoleId = 5 // Technician RoleId
            };

            _context.Users.Add(user);
            _context.SaveChanges();

            var fromTime = TimeSpan.Parse(technicianDto.FromTime);
            var toTime = TimeSpan.Parse(technicianDto.ToTime);
            // Create the Technician entity
            var technician = new Technician
            {
                TechnicianId = user.UserId, // Match UserId
                FromTime = fromTime,
                ToTime = toTime,
                Specialization = technicianDto.Specialization,
                Contacts = technicianDto.Contacts
            };

            _context.Technicians.Add(technician);
            _context.SaveChanges();
        }

        public List<TechnicianDto> GetAllTechnicians()
        {
            var technicians = _context.Technicians
                .Select(t => new TechnicianDto
                {
                    Surname = t.User.Surname,
                    Initials = t.User.Initials,
                    EmailAddress = t.User.EmailAddress,
                    DepartmentId = t.User.DepartmentId,
                    FromTime = t.FromTime.ToString(@"hh\:mm"), // Format without trailing zeros
                    ToTime = t.ToTime.ToString(@"hh\:mm"),
                    ActiveTasks = _context.Logs.Count(l => l.TechnicianId == t.TechnicianId && (l.LogStatus == "INPROGRESS" || l.LogStatus == "PENDING")),
                    NoOfTask = _context.Logs.Count(l => l.TechnicianId == t.TechnicianId),
                    Specialization = t.Specialization,
                    Contacts = t.Contacts
                }).ToList();

            return technicians;
        }

        public TechnicianDto? GetTechnicianById(int technicianId)
        {
            // Fetch the Technician with related User data
            var technician = _context.Technicians
                .FirstOrDefault(t => t.TechnicianId == technicianId);

            // Handle the case where the Technician is not found
            if (technician == null)
                throw new Exception("Technician not found.");

            // Map the Technician and related User properties to the TechnicianDto
            return new TechnicianDto
            {
                Surname = technician.User.Surname,
                Initials = technician.User.Initials,
                EmailAddress = technician.User.EmailAddress,
                Password = technician.User.PasswordHash,
                DepartmentId = technician.User.DepartmentId,
                FromTime = technician.FromTime.ToString(),
                ToTime = technician.ToTime.ToString(),
                Specialization = technician.Specialization,
                Contacts = technician.Contacts
            };
        }
        public void UpdateTechnician(int technicianId, TechnicianDto technicianDto)
        {
            var technician = _context.Technicians.FirstOrDefault(t => t.TechnicianId == technicianId);
            if (technician == null) throw new Exception("Technician not found.");

            var user = _context.Users.FirstOrDefault(u => u.UserId == technicianId);
            if (user == null) throw new Exception("Associated user not found.");

            user.Surname = technicianDto.Surname;
            user.Initials = technicianDto.Initials;
            user.EmailAddress = technicianDto.EmailAddress;
            user.PasswordHash = HashPassword(technicianDto.Password);
            user.DepartmentId = technicianDto.DepartmentId;

            technician.FromTime = TimeSpan.Parse(technicianDto.FromTime ?? "00:00:00");
            technician.ToTime = TimeSpan.Parse(technicianDto.ToTime ?? "00:00:00");
            technician.Specialization = technicianDto.Specialization;
            technician.Contacts = technicianDto.Contacts;

            _context.SaveChanges();
        }

        public void DeleteTechnician(int technicianId)
        {
            var technician = _context.Technicians.FirstOrDefault(t => t.TechnicianId == technicianId);
            if (technician == null) throw new Exception("Technician not found.");

            var user = _context.Users.FirstOrDefault(u => u.UserId == technicianId);

            if (user != null) _context.Users.Remove(user);

            _context.Technicians.Remove(technician);
            _context.SaveChanges();
        }

        private string HashPassword(string password)
        {
            return password; // Replace with actual password hashing logic
        }
    }
}

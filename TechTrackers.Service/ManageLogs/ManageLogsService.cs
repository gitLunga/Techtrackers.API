using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using TechTrackers.Data;
using TechTrackers.Data.Model;
using TechTrackers.Data.Model.dto;

namespace TechTrackers.Service.ManageLogs
{
    public class ManageLogsService : IManageLogs
    {

        private readonly TechTrackersDbContext _dbContext;

        public ManageLogsService(TechTrackersDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        private async Task NotifyUsersOnStatusChange(Log log, string newStatus)
        {
            // Notify the staff member who logged the issue
            if (log.StaffId != null)
            {
                var notificationForStaff = new Notification
                {
                    LogId = log.LogId,
                    UserId = log.StaffId, // Notify the staff member
                    Message = $"The status of your issue with reference ID: {log.IssueId} has been updated to '{newStatus}'.",
                    Type = "INFORMATION",
                    Timestamp = DateTime.Now,
                    ReadStatus = false
                };
                await _dbContext.Notifications.AddAsync(notificationForStaff);
            }

            // Notify admins about the status change
            var adminUsers = await _dbContext.Users
                .Where(u => u.Role.RoleName == "Admin") // Assuming Role is a navigation property
                .ToListAsync();

            foreach (var admin in adminUsers)
            {
                var notificationForAdmin = new Notification
                {
                    LogId = log.LogId,
                    UserId = admin.UserId, // Notify each admin
                    Message = $"The status of the issue titled: '{log.IssueTitle}' (ID: {log.IssueId}) has been updated to '{newStatus}'.",
                    Type = "ALERT",
                    Timestamp = DateTime.Now,
                    ReadStatus = false
                };
                await _dbContext.Notifications.AddAsync(notificationForAdmin);
            }

            // Save all notifications
            await _dbContext.SaveChangesAsync();

            Console.WriteLine("Notifications have been successfully created and saved for the relevant users.");
        }




        public async Task<bool> ChangeLogStatus(string issueId, string newStatus, string? note)
        {
            Console.WriteLine($"Received request to change status for log with IssueId: {issueId} to {newStatus}");

            try
            {
                // Search for the log by IssueId
                var log = await _dbContext.Logs
                    .FirstOrDefaultAsync(l => l.IssueId == issueId);

                if (log == null)
                {
                    Console.WriteLine($"Log with IssueId: {issueId} not found.");
                    return false;
                }

                // Update the log status
                log.LogStatus = newStatus;
                log.UpdatedAt = DateTime.UtcNow;

                if (newStatus.ToUpper() == "ONHOLD" && !string.IsNullOrWhiteSpace(note))
                {
                    log.Note = note;
                }

                // Save changes to the database
                await _dbContext.SaveChangesAsync();
                Console.WriteLine($"Status updated successfully for log with IssueId: {issueId}");

                await NotifyUsersOnStatusChange(log, newStatus);

                return true;
            }
            catch (Exception ex)
            {
                // Log detailed error messages for debugging
                Console.WriteLine($"Error occurred while updating status for log with IssueId: {issueId}. Error: {ex.Message}");
                if (ex.InnerException != null)
                {
                    Console.WriteLine($"Inner Exception: {ex.InnerException.Message}");
                }
                return false;
            }
        }





        public async Task<bool> CloseLog(int logId)
        {
            var log = await _dbContext.Logs.FindAsync(logId);
            if (log == null) return false;

            log.LogStatus = "CLOSED";
            log.UpdatedAt = DateTime.UtcNow;
            await _dbContext.SaveChangesAsync();

            return true;
        }

        public async Task<int> CountAllLogsAsync()
        {
            return await _dbContext.Logs.CountAsync();
        }

        public async Task<int> CountLogsByStatusAsync(string status)
        {
            return await _dbContext.Logs
                .CountAsync(log => log.LogStatus != null &&
                                   log.LogStatus.ToLower() == status.ToLower());
        }


        public async Task<IEnumerable<LogDetailDto>> GetOpenLogsAsync()
        {
            var logs = await _dbContext.Logs
                .Include(log => log.Staff)
                .ThenInclude(staff => staff.Department)
                .Include(log => log.Technician)
                .Include(log => log.Category)
                .Where(log => log.LogStatus == "INPROGRESS")
                .ToListAsync();

            return logs.Select(log => new LogDetailDto
            {
                IssueId = $"LOG-{log.LogId:D4}",
                CategoryName = log.Category?.CategoryName,
                IssuedAt = log.CreatedAt.ToString("yyyy-MM-dd hh:mm tt"),
                Priority = log.Priority,
                Department = log.Staff?.Department?.DepartmentName,
                Status = log.LogStatus ?? "PENDING",
                Description = log.Description,
                Location = log.Location,
                AttachmentBase64 = log.AttachmentFile != null ? Convert.ToBase64String(log.AttachmentFile) : null,
                AssignedTo = log.Technician != null ? $"{log.Technician.Initials} {log.Technician.Surname}" : "Unassigned"
            });
        }

        public async Task<bool> OpenLog(int logId)
        {
            var log = await _dbContext.Logs.FindAsync(logId);
            if (log == null) return false;

            log.LogStatus = "PENDING";
            log.UpdatedAt = DateTime.UtcNow;

            var rowsAffected = await _dbContext.SaveChangesAsync();
            if (rowsAffected == 0) return false; // ❌ Prevent false success when DB is not updated

            if (log.TechnicianId.HasValue)
            {
             //   ($"Sending notification to Technician ID: {log.TechnicianId.Value}");

                var notification = new Notification
                {
                    UserId = log.TechnicianId.Value,
                    LogId = logId,
                    Type = "ALERT",
                    Message = $"Issue '{log.IssueTitle}' has been reopened for further investigation.",
                    Timestamp = DateTime.UtcNow
                };

                _dbContext.Notifications.Add(notification);
                await _dbContext.SaveChangesAsync();
            }
          

            return true;
        }



        public async Task<Log> GetIssueByIdAsync(int id)
        {
            return await _dbContext.Logs.FindAsync(id);
        }

        /*  public async Task<bool> ChangeLogStatus(int logId, string newStatus)
         {
             var log = await _dbContext.Logs.FindAsync(logId);
             if (log == null) return false;

             log.LogStatus = newStatus.ToUpper(); // Ensure status is stored consistently
             log.UpdatedAt = DateTime.UtcNow;
             await _dbContext.SaveChangesAsync();

             return true;
         }*/
    }
}

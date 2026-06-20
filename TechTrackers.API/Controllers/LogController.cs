using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using TechTrackers.Service;
using TechTrackers.Data.Model;
using TechTrackers.Data.Model.dto;
using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
using TechTrackers.Data;

namespace TechTrackers.API.Controllers
{
    [ApiController]
    [Route("api/[controller]/[action]")]
    [EnableCors("corspolicy")]
    public class LogController : ControllerBase
    {
        private readonly LogService _logService;
        private readonly ILogger<LogController> _logger;
        private readonly TechTrackersDbContext? _dbContext;

        public LogController(TechTrackersDbContext dbContext, LogService logService, ILogger<LogController> logger)
        {
            _logService = logService;
            _logger = logger;
            _dbContext = dbContext ?? throw new ArgumentNullException(nameof(dbContext));
        }

        [HttpPost]
        public async Task<IActionResult> CreateLog([FromForm] LogDto logDto)
        {
            /*try
            {
                //int staffId = logDto.Staff_ID;  // Ensure staffId is extracted
                var log = await _logService.LogIssue(logDto);
                return Ok(log);
            }
            catch (KeyNotFoundException ex)
            {
                _logger.LogError(ex, "Key not found while creating log.");
                return NotFound(new { message = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogError(ex, "Invalid operation while creating log.");
                return BadRequest(new { message = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error: {ex.Message}"); // Log the main error
                if (ex.InnerException != null)
                {
                    // Log the inner exception if available
                    _logger.LogError($"Inner Exception: {ex.InnerException.Message}");
                }
                return StatusCode(500, new { message = "An internal server error occurred." });
            }*/

            if (logDto == null)
            {
                return BadRequest(new { message = "Invalid log data received." });
            }

            try
            {

                var log = await _logService.LogIssue(logDto);
                return Ok(log);
            }
            catch (ValidationException ex)
            {
                return BadRequest(new { message = ex.Message, errors = ex.Data });
            }
            catch (Exception ex)
            {
                Console.WriteLine("Error details:", ex);
                return StatusCode(500, new { message = "An internal server error occurred." });
            }
        }

        [HttpGet]
        public async Task<ActionResult<IEnumerable<Log>>> GetLogsForStaff([FromQuery] int? userId)
        {
            try
            {
                var logsForStaff = await _logService.GetAllLogsAsync(userId, false);
                return Ok(logsForStaff);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "An error occurred while retrieving logs.");
                return StatusCode(500, new { message = "An internal server error occurred.", details = ex.Message });
            }
        }

        [HttpGet]
        public async Task<ActionResult<IEnumerable<AdminLogDto>>> GetLogsTechnician([FromQuery] int? userId)
        {
            try
            {
                var logsForTechnician = await _logService.GetAllLogsAsync(userId, true);
                return Ok(logsForTechnician);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "An error occurred while retrieving logs.");
                return StatusCode(500, new { message = "An internal server error occurred.", details = ex.Message });
            }
        }

        [HttpPost]
        public async Task<IActionResult> AssignTechnician([FromBody] AssignTechnicianDto assignDto)
        {
            try
            {
                _logger.LogInformation($"Received AssignTechnicianDto: LogId = {assignDto.LogId}, TechnicianId = {assignDto.TechnicianId}");

                if (assignDto.LogId <= 0 || assignDto.TechnicianId <= 0)
                {
                    return BadRequest(new { message = "Invalid LogId or TechnicianId." });
                }

                // Retrieve the log
                var log = await _dbContext.Logs.Include(l => l.SLA).FirstOrDefaultAsync(l => l.LogId == assignDto.LogId);
                if (log == null)
                {
                    return NotFound(new { message = "Log not found." });
                }

                // Check if a technician is already assigned
                if (log.TechnicianId.HasValue)
                {
                    return BadRequest(new { message = "A technician has already been assigned to this log." });
                }

                // Assign technician and set dates
                log.TechnicianId = assignDto.TechnicianId;
                log.AssignedAt = DateTime.Now;

                if (log.SLA != null)
                {
                    log.ResponseDue = log.AssignedAt.AddMinutes(log.SLA.ResponseTimeframe);
                    log.ResolutionDue = null;  // Wait for response countdown to end
                }

                log.UpdatedAt = DateTime.Now;
                _dbContext.Logs.Update(log);
                await _dbContext.SaveChangesAsync();

                // Notify the assigned technician
                var technician = await _dbContext.Users.FirstOrDefaultAsync(u => u.UserId == assignDto.TechnicianId);
                if (technician != null)
                {
                    var resolutionDeadline = log.AssignedAt.AddMinutes(log.SLA?.ResolutionTimeframe ?? 0);
                    var notification = new Notification
                    {
                        LogId = log.LogId,
                        UserId = technician.UserId,
                        Message = $"You have been assigned to resolve the issue titled: '{log.IssueTitle}'.\n" +
                                  $"Details:\n" +
                                  $"- Issue ID: {log.IssueId}\n" +
                                  $"- Location: {log.Location}\n" +
                                  $"- Priority: {log.Priority}\n" +
                                  $"- Resolution Deadline: {resolutionDeadline:yyyy-MM-dd HH:mm}\n\n" +
                                  "Please ensure this issue is resolved within the specified time frame.",
                        Type = "ALERT",
                        Timestamp = DateTime.Now,
                        ReadStatus = false
                    };

                    await _dbContext.Notifications.AddAsync(notification);
                    await _dbContext.SaveChangesAsync();

                    _logger.LogInformation($"Notification sent to technician ID: {technician.UserId}");
                }
                else
                {
                    _logger.LogWarning($"Technician with ID {assignDto.TechnicianId} not found. Notification skipped.");
                }

                return Ok(new
                {
                    message = "Technician assigned successfully.",
                    ResponseDue = log.ResponseDue,
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error assigning technician");
                return StatusCode(500, new { message = "An internal server error occurred." });
            }
        }




        [HttpGet]
        public async Task<IActionResult> GetEscalationResults(int logId)
        {
            var log = await _dbContext.Logs
                .Include(l => l.SLA)
                .FirstOrDefaultAsync(l => l.LogId == logId);

            if (log == null)
            {
                return NotFound(new { message = "Log not found" });
            }

            var currentTime = DateTime.Now;
            var responseDueInSeconds = log.ResponseDue.HasValue
                ? (int)(log.ResponseDue.Value - currentTime).TotalSeconds
                : 0;
            var resolutionDueInSeconds = log.ResolutionDue.HasValue
                ? (int)(log.ResolutionDue.Value - currentTime).TotalSeconds
                : 0;

            return Ok(new
            {
                log.LogId,
                log.LogStatus,
                escalationLevel = CalculateEscalation(log, currentTime),
                responseDueInSeconds,
                resolutionDueInSeconds
            });
        }

      

        // method to calculate the escalation level

        private int CalculateEscalation(Log log, DateTime currentTime)
        {
            if (log.ResolutionDue <= currentTime && log.LogStatus != "RESOLVED")
                return 3; // Escalation to senior management
            if (log.ResponseDue <= currentTime && log.LogStatus == "PENDING")
                return 2; // Escalation to supervisor/manager
            return 1; // Normal level with no escalation
        }









        /*================================================================================================================*/
        //NOTIFICATIONS STILL UNDER CONSIDARATION
        [HttpGet("{userId}")]
        public async Task<IActionResult> GetNotifications(int userId, [FromQuery] bool onlyUnread = false)
        {
            try
            {
                var notifications = await _logService.GetNotificationsAsync(userId, onlyUnread);
                return Ok(notifications);
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error fetching notifications for user {userId}: {ex.Message}");
                return StatusCode(500, new { message = "An internal server error occurred." });
            }
        }


    }
}

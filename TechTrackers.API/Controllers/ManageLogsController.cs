using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using System.Drawing.Text;
using System.Text.RegularExpressions;
using TechTrackers.Data.Model.dto;
using TechTrackers.Service;
using TechTrackers.Service.ManageLogs;

namespace TechTrackers.API.Controllers
{
    [Route("api/[controller]/[action]")]
    [EnableCors("corspolicy")]
    public class ManageLogsController : Controller
    {
        private readonly IManageLogs _manageLogs;

        public ManageLogsController(IManageLogs manageLogs)
        {
            _manageLogs = manageLogs;
        }

        // Count all logs
        [HttpGet]
        public async Task<IActionResult> CountAllLogs()
        {
            var count = await _manageLogs.CountAllLogsAsync();
            return Ok(new RespondWrapper
            {
                IsSuccess = true,
                Message = "Counted all logs successfully.",
                Result = count
            });
        }

        // Count logs by status
        [HttpGet("{status}")]
        public async Task<IActionResult> CountLogsByStatus(string status)
        {
            var count = await _manageLogs.CountLogsByStatusAsync(status);
            return Ok(new RespondWrapper
            {
                IsSuccess = true,
                Message = $"Counted logs with status '{status}' successfully.",
                Result = count
            });
        }

        // Get open logs
        [HttpGet]
        public async Task<IActionResult> GetOpenLogs()
        {
            var logs = await _manageLogs.GetOpenLogsAsync();
            return Ok(new RespondWrapper
            {
                IsSuccess = true,
                Message = "Retrieved open logs successfully.",
                Result = logs
            });
        }

        // Open a log
        [HttpPut("{logId}")]
        public async Task<IActionResult> OpenLog(int logId)
        {
            var success = await _manageLogs.OpenLog(logId);
            if (!success)
            {
                return NotFound(new RespondWrapper
                {
                    IsSuccess = false,
                    Message = $"Log with ID {logId} not found."
                });
            }

            return Ok(new RespondWrapper
            {
                IsSuccess = true,
                Message = $"Log with ID {logId} opened successfully. The assigned technician has been notified."
            });
        }

        // Close a log
        [HttpPut("{logId}")]
        public async Task<IActionResult> CloseLog(int logId)
        {
            var success = await _manageLogs.CloseLog(logId);
            if (!success)
            {
                return NotFound(new RespondWrapper
                {
                    IsSuccess = false,
                    Message = $"Log with ID {logId} not found."
                });
            }

            return Ok(new RespondWrapper
            {
                IsSuccess = true,
                Message = $"Log with ID {logId} closed successfully."
            });
        }

        /*   [HttpPut("{logId}/{newStatus}")]
           public async Task<IActionResult> ChangeLogStatus(int logId, string newStatus)
           {
               var success = await _manageLogs.ChangeLogStatus(logId, newStatus);
               if (!success)
               {
                   return NotFound(new RespondWrapper
                   {
                       IsSuccess = false,
                       Message = $"Log with ID {logId} not found."
                   });
               }

               return Ok(new RespondWrapper
               {
                   IsSuccess = true,
                   Message = $"Log with ID {logId} status changed to '{newStatus}' successfully."
               });
           }*/
        [HttpPut("{issueId}/{newStatus}")]
        public async Task<IActionResult> ChangeLogStatus(string issueId, string newStatus, [FromBody] LogDetailDto logDetailDto = null)
        {
            Console.WriteLine($"Received request: logId = {issueId}, newStatus = {newStatus}");
            newStatus = newStatus.ToUpper();

            var validStatuses = new[] { "PENDING", "INPROGRESS", "ONHOLD", "RESOLVED" };

            if (!validStatuses.Contains(newStatus))
            {
                return BadRequest(new RespondWrapper
                {
                    IsSuccess = false,
                    Message = $"Invalid status value: {newStatus}. Valid statuses are: {string.Join(", ", validStatuses)}."
                });
            }

            // Validate note requirement for ONHOLD status
            if (newStatus == "ONHOLD" && string.IsNullOrWhiteSpace(logDetailDto?.Note))
            {
                return BadRequest(new RespondWrapper
                {
                    IsSuccess = false,
                    Message = "Note is required for ONHOLD status."
                });
            }

            try
            {
                var note = newStatus == "ONHOLD" ? logDetailDto.Note : null;
                var success = await _manageLogs.ChangeLogStatus(issueId, newStatus, note);

                if (!success)
                {
                    Console.WriteLine($"Log not found: {issueId}");
                    return NotFound(new RespondWrapper
                    {
                        IsSuccess = false,
                        Message = $"Log with ID {issueId} not found."
                    });
                }

                Console.WriteLine($"Status updated: logId = {issueId}, newStatus = {newStatus}");
                return Ok(new RespondWrapper
                {
                    IsSuccess = true,
                    Message = $"Log with ID {issueId} status successfully changed to '{newStatus}'."
                });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new RespondWrapper
                {
                    IsSuccess = false,
                    Message = ex.Message
                });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Unexpected error: {ex.Message}");
                return StatusCode(500, new RespondWrapper
                {
                    IsSuccess = false,
                    Message = "An unexpected error occurred.",
                    Result = ex.Message
                });
            }
        }


        [HttpGet("GetIssue/{id}")]
        public async Task<IActionResult> GetIssueById(int id)
        {
           /* try
            {
                var issue = await _manageLogs.GetIssueByIdAsync(id);
                if (issue == null)
                {
                    return NotFound(new { Message = $"Issue with ID {id} not found." });
                }

                return Ok(issue);
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { Message = "An error occurred.", Details = ex.Message });
            }*/

            try
            {
                var issue = await _manageLogs.GetIssueByIdAsync(id);
                if (issue == null)
                {
                    return NotFound(new { Message = $"Issue with ID {id} not found." });
                }

                return Ok(issue); // Return issue as JSON
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { Message = "An error occurred.", Details = ex.Message });
            }
        }


    }
}


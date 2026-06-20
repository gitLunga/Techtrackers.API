using MailKit;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using TechTrackers.Data;
using TechTrackers.Data.Model;
using TechTrackers.Data.Model.dto;
using TechTrackers.Service;

namespace TechTrackers.API.Controllers
{
    [ApiController]
    [Route("api/Collaboration")]
    public class CollabController : ControllerBase
    {
        private readonly TechTrackersDbContext _dbContext;
        private readonly ILogger<CollabController> _logger;

        public CollabController(TechTrackersDbContext dbContext, ILogger<CollabController> logger)
        {
            _dbContext = dbContext ?? throw new ArgumentNullException(nameof(dbContext));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        }

        [HttpPost("Request")]
        public async Task<IActionResult> RequestCollaboration([FromBody] CollabRequestDto requestDto)
        {
            try
            {
                if (requestDto == null || requestDto.LogId <= 0 || requestDto.RequestingTechnicianId <= 0 || requestDto.InvitedTechnicianId <= 0)
                {
                    return BadRequest(new { Message = "Invalid request data." });
                }

                var requestingTechnician = await _dbContext.Users.FindAsync(requestDto.RequestingTechnicianId);
                var invitedTechnician = await _dbContext.Users.FindAsync(requestDto.InvitedTechnicianId);

                if(requestingTechnician == null || invitedTechnician == null)
                {
                    return BadRequest(new { Message = "Invalid technician ID(s)." });
                }

                var existingRequest = await _dbContext.CollaborationRequests
                    .FirstOrDefaultAsync(c => c.RequestingTechnicianId == requestDto.RequestingTechnicianId &&
                                              c.InvitedTechnicianId == requestDto.InvitedTechnicianId &&
                                              c.LogId == requestDto.LogId &&
                                              c.Status == "PENDING");
                if (existingRequest != null)
                {
                    return BadRequest(new { Message = "A pending collaboration request already exists." });
                }

                var collaboration = new CollaborationRequests
                {
                    LogId = requestDto.LogId,
                    RequestingTechnicianId = requestDto.RequestingTechnicianId,
                    InvitedTechnicianId = requestDto.InvitedTechnicianId,
                    Status = "PENDING",
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow
                };

                await _dbContext.CollaborationRequests.AddAsync(collaboration);
                await _dbContext.SaveChangesAsync();

                // 2. Get invited technician info
                var invitedTech = await _dbContext.Users.FindAsync(requestDto.InvitedTechnicianId);
                var log = await _dbContext.Logs.FindAsync(requestDto.LogId);

                // 3. Send email
                var mailService = new MailServices();
                await mailService.SendCollaborationEmail(invitedTech.EmailAddress, invitedTech.Surname, log.IssueTitle);

                return Ok(new { message = "Collaboration request created and email sent!" });

            } catch (Exception ex)
            {
                // Log the exception
                _logger.LogError(ex, "An error occurred while processing the collaboration request.");
                return StatusCode(500, new { Message = "An error occurred while processing your request." });
            }
           
        }

        [HttpPut("Respond/{collaborationId}")]
        public async Task<IActionResult> RespondToCollaboration(int collaborationId, [FromBody] CollabResponseDto responseDto)
        {
            if (responseDto == null || string.IsNullOrEmpty(responseDto.Status))
            {
                return BadRequest(new { Message = "Invalid request format. Status is required." });
            }

            var collaboration = await _dbContext.CollaborationRequests
                .FirstOrDefaultAsync(cr => cr.CollaboratedId == collaborationId);
            
            if (collaboration == null)
            {
                return NotFound(new { Message = "Collaboration request not found." });
            }

            if (collaboration.Status != "PENDING")
            {
                return BadRequest(new { Message = "This collaboration request has already been processed." });
            }

            if(responseDto.Status.ToUpper() != "ACCEPTED" && responseDto.Status.ToUpper() != "DECLINED")
            {
                return BadRequest(new { Message = "Invalid status. Status must be either 'ACCEPTED' or 'DECLINED' ." });
            }

            collaboration.Status = responseDto.Status.ToUpper();
            collaboration.UpdatedAt = DateTime.UtcNow;

            _dbContext.CollaborationRequests.Update(collaboration);
            await _dbContext.SaveChangesAsync();

            return Ok(new { Message = $"Collaboration request {responseDto.Status.ToLower()} successfully updated." });
        }

        [HttpGet("Pending/{technicianId}")]
        public async Task<IActionResult> GetPendingRequests(int technicianId)
        {
            var requests = await _dbContext.CollaborationRequests
                .Where(cr => cr.InvitedTechnicianId == technicianId && cr.Status == "PENDING")
                .Include(cr => cr.RequestTech)
                .ToListAsync();

            var response = requests.Select(r => new
            {
                r.CollaboratedId,
                r.LogId,
                RequestingTechnician = new
                {
                    r.RequestTech.UserId,
                    r.RequestTech.Surname,
                    r.RequestTech.Initials,
                    r.RequestTech.EmailAddress,
                    r.RequestTech.DepartmentId
                },
                r.Status,
                r.CreatedAt
            });

            return Ok(response);
        }

        [HttpGet("List/{technicianId}")]
        public async Task<IActionResult> GetCollaborations(int technicianId)
        {
            var collaborations = await _dbContext.CollaborationRequests
                .Where(c => c.RequestingTechnicianId == technicianId || c.InvitedTechnicianId == technicianId)
                .Include(c => c.RequestTech)
                .Include(c => c.InviteTech)
                .ToListAsync();

            var response = collaborations.Select(c => new
            {
                c.CollaboratedId,
                c.LogId,
                RequestingTechnician = new
                {
                    c.RequestTech.UserId,
                    c.RequestTech.Surname,
                    c.RequestTech.Initials,
                    c.RequestTech.EmailAddress,
                    c.RequestTech.DepartmentId
                },
                InvitedTechnician = new
                {
                    c.InviteTech.UserId,
                    c.InviteTech.Surname,
                    c.InviteTech.Initials,
                    c.InviteTech.EmailAddress,
                    c.InviteTech.DepartmentId
                },
                c.Status,
                c.CreatedAt
            });

            return Ok(response);
        }
    }
}

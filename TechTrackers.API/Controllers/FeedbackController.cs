using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using TechTrackers.Data.Model.dto;
using TechTrackers.Data.Model;
using TechTrackers.Data;
using Microsoft.EntityFrameworkCore;

namespace TechTrackers.API.Controllers
{

   //[ApiController]
    [Route("api/[controller]/[action]")]
    [EnableCors("corspolicy")]
    public class FeedbackController : ControllerBase
    {
        private readonly TechTrackersDbContext _context;

        public FeedbackController(TechTrackersDbContext context)
        {
            _context = context;
        }

        // POST: api/Feedback
        [HttpPost]
        public async Task<IActionResult> SubmitFeedback([FromBody] FeedbackDto feedbackDto)
        {
            if (feedbackDto == null || feedbackDto.Rating == 0)
                return BadRequest("Invalid feedback submission");

            var feedback = new Feedback
            {
                LogId = feedbackDto.Log_ID,
                UserId = feedbackDto.User_ID,
                Rating = feedbackDto.Rating,
                Comments = feedbackDto.Comment,
                FeedbackTimestamp = DateTime.Now
            };

            _context.Feedbacks.Add(feedback);
            await _context.SaveChangesAsync();

            return Ok(feedback);
        }

        // GET: api/Feedback/{logId}
        [HttpGet("{logId}")]
        public async Task<IActionResult> GetFeedbackByLog(int logId)
        {
            var feedbackList = await _context.Feedbacks
                .Where(f => f.LogId == logId)
                .ToListAsync();

            if (!feedbackList.Any())
                return NotFound("No feedback found for the given log ID");

            return Ok(feedbackList);
        }
    }
}

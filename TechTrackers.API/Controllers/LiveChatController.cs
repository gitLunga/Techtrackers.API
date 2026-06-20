using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using TechTrackers.API.Hubs;
using TechTrackers.Data;
using TechTrackers.Data.Model;
using Microsoft.EntityFrameworkCore;
namespace TechTrackers.API.Controllers
{
    [Route("api/[controller]/[action]")]
    [EnableCors("corspolicy")]
    public class LiveChatController : Controller
    {
        private readonly TechTrackersDbContext _dbContext;
        private readonly IHubContext<ChatHub> _hubContext;

        public LiveChatController(TechTrackersDbContext dbContext, IHubContext<ChatHub> hubContext)
        {
            _dbContext = dbContext;
            _hubContext = hubContext;
        }

        [HttpPost]
        public async Task<IActionResult> SendMessage([FromBody] SendMessageRequest request)
        {
            if (string.IsNullOrEmpty(request.Message))
                return BadRequest("Message cannot be empty.");

            var chatMessage = new LogChat
            {
                LogId = request.LogId,
                SenderId = request.SenderId,
                Message = request.Message,
                Timestamp = DateTime.UtcNow
            };

            _dbContext.Log_chats.Add(chatMessage);
            await _dbContext.SaveChangesAsync();

            // Broadcast message to SignalR clients
            await _hubContext.Clients.Group($"{request.LogId}").SendAsync("ReceiveMessage", request.LogId, request.SenderId, request.Message, chatMessage.Timestamp);

            return Ok(new { message = "Message sent successfully.", chatMessage });
        }

        public class SendMessageRequest
        {
            public int LogId { get; set; }
            public int SenderId { get; set; }
            public string Message { get; set; }
        }

        // ✅ Retrieve messages for a specific LogId
        [HttpGet("{logId}")]
        public async Task<IActionResult> GetMessages(int logId)
        {
            var messages = await _dbContext.Log_chats
                .Where(c => c.LogId == logId)
                .OrderBy(c => c.Timestamp)
                .Select(c => new
                {
                    c.SenderId,
                    c.Message,
                    c.Timestamp
                })
                .ToListAsync();

            return Ok(messages);
        }
    }
}

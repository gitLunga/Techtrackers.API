
using Microsoft.EntityFrameworkCore;
using System.Linq;
using System.Threading.Tasks;
using TechTrackers.Service;
using Microsoft.AspNetCore.Mvc;
using TechTrackers.Data;

namespace TechTrackers.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class NewNotificationController : ControllerBase
    {
        private readonly INotificationService _notificationService;
        private readonly TechTrackersDbContext _dbContext;

        public NewNotificationController(INotificationService notificationService, TechTrackersDbContext dbContext)
        {
            _notificationService = notificationService;
            _dbContext = dbContext;
        }

        // Fetch notifications for a specific user
        [HttpGet("{userId}/staged")]
        public async Task<IActionResult> GetUserNotificationsStaged(int userId, [FromQuery] bool showUnread = false)
        {
            try
            {
                var notificationsQuery = _dbContext.Notifications
                    .AsNoTracking() // Ensure fresh data is fetched
                    .Where(n => n.UserId == userId);

                if (showUnread)
                {
                    notificationsQuery = notificationsQuery.Where(n => !n.ReadStatus);
                }

                var notifications = await notificationsQuery.ToListAsync();

                return Ok(notifications);
            }
            catch (Exception ex)
            {
                return StatusCode(500, new
                {
                    message = "An error occurred while retrieving notifications.",
                    error = ex.Message
                });
            }
        }

        // Mark notification as read
        [HttpPost("markAsRead/{notificationId}")]
        public async Task<IActionResult> MarkNotificationAsRead(int notificationId)
        {
            try
            {
                var notification = await _dbContext.Notifications.FindAsync(notificationId);
                if (notification == null)
                {
                    return NotFound(new { message = "Notification not found" });
                }

                if (!notification.ReadStatus)
                {
                    notification.ReadStatus = true;
                    await _dbContext.SaveChangesAsync();
                }

                return Ok(new { message = "Notification marked as read" });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new
                {
                    message = "An error occurred while updating the notification.",
                    error = ex.Message
                });
            }
        }
    }
}

using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using TechTrackers.Data.Model;
using TechTrackers.Data.Model.dto;
using TechTrackers.Service;

/*namespace TechTrackers.API.Controllers
{
    [ApiController]
    [Route("api/[controller]/[action]")]
    [EnableCors("corspolicy")]
    public class NotificationController : ControllerBase
    {
        private readonly INotificationService _notificationService;

       /* public NotificationController(INotificationService notificationService)
        {
            _notificationService = notificationService;
        }

        /*[HttpPost]
        public async Task<IActionResult> Notify([FromBody] Notification notifications)
        {
            var respondWrapper = new RespondWrapper
            {
                IsSuccess = false,
                Message = "Unable to send notification."
            };

            var result = await _notificationService.SendNotification(notifications);

            if (result != null)
            {
                respondWrapper = new RespondWrapper
                {
                    IsSuccess = true,
                    Message = "Notification sent.",
                    Result = result
                };
            }

            return Ok(respondWrapper);  // 'Ok' method now available
        }

        [HttpGet]
        public IActionResult ReceiveNotification()
        {
            var respondWrapper = new RespondWrapper
            {
                IsSuccess = false,
                Message = "Unable to fetch notification."
            };

            var results = _notificationService.GetNotifications();

            if (results.Any())
            {
                respondWrapper = new RespondWrapper
                {
                    IsSuccess = true,
                    Message = $"{results.Count()} new notification(s) received.",
                    Result = results
                };
            }

            return Ok(respondWrapper);  // 'Ok' method now available
        }
    }
}
        */
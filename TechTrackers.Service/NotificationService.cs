using Microsoft.EntityFrameworkCore;
using TechTrackers.Data;
using TechTrackers.Data.Model;

namespace TechTrackers.Service
{
    public class NotificationService : INotificationService
    {
        private readonly TechTrackersDbContext _dbContext;

        public NotificationService(TechTrackersDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        /*public async Task<Notification> SendNotification(Notification notifications)
        {
            await _dbContext.Notifications.AddAsync(notifications);
            await _dbContext.SaveChangesAsync();
            return notifications;
        }*/

        /*public IEnumerable<Notification> GetNotifications()
        {
            return _dbContext.Notifications.ToList();
        }

        IEnumerable<Notification> INotificationService.GetNotifications(int userId)
        {
            throw new NotImplementedException();
        }*/
        public async Task<List<Notification>> GetNotifications(int userId)
        {
            return await _dbContext.Notifications
                .Where(n => n.UserId == userId)
                .OrderByDescending(n => n.Timestamp)
                .ToListAsync();
        }
    }
}

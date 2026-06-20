using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TechTrackers.Data.Model;

namespace TechTrackers.Service
{
    public interface INotificationService
    {
        //Task<Notification> SendNotification(Notification notifications);
        Task<List<Notification>> GetNotifications(int userId);
    }
}

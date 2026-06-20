using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model.dto
{
    public class NotificationDto
    {
        public int NotificationId { get; set; }
        public int LogId { get; set; }
        public int UserId { get; set; }
        public string Message { get; set; } = string.Empty;
        public string? Type { get; set; } // 'INFORMATION', 'WARNING', 'ALERT'
        public DateTime Timestamp { get; set; }
        public bool ReadStatus { get; set; }
    }
}

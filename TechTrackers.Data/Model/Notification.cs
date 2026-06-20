using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations.Schema;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model
{
    public class Notification
    {
        [Key]
        public int NotificationId { get; set; }

        [ForeignKey("Log")]
        public int LogId { get; set; }
        public Log? Log { get; set; }

        [ForeignKey("User")]
        public int UserId { get; set; }
        public User? User { get; set; }

        public string Message { get; set; } = string.Empty;

        public string? Type { get; set; } // 'INFORMATION', 'WARNING', 'ALERT'

        public DateTime Timestamp { get; set; } = DateTime.Now;

        public bool ReadStatus { get; set; } = false;
    }
}

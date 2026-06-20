using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model.dto
{
    public class EscalationDto
    {
        public int LogId { get; set; }
        public int EscalationLevel { get; set; }
        public string NotificationType { get; set; } = string.Empty;
        public int EscalationDelay { get; set; }
        public string Reason { get; set; } = string.Empty;
        public DateTime Timestamp { get; set; } = DateTime.Now;
    }
}

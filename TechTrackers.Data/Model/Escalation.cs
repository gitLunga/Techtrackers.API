using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations.Schema;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model
{
    public class Escalation
    {
        [Key]
        public int EscalationId { get; set; }

        [ForeignKey("Log")]
        public int LogId { get; set; }
        public Log? Log { get; set; }
        public int Escalation_Level { get; set; }

        [ForeignKey("User")]
        public int HODId { get; set; }
        public User? HOD { get; set; }
        public string? Notification_Type { get; set; }
        public int Escalation_Delay { get; set; }

        [Required]
        public string? Reason { get; set; }

        public DateTime Timestamp { get; set; } = DateTime.Now;
    }
}

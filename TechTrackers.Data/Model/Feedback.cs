using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations.Schema;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model
{
    public class Feedback
    {
        [Key]
        public int FeedbackId { get; set; }

        [ForeignKey("Log")]
        public int LogId { get; set; }
        public Log? Log { get; set; }

        [ForeignKey("User")]
        public int UserId { get; set; }
        public User? User { get; set; }

        public int Rating { get; set; } // 'EXCELLENT', 'GOOD', etc.

        public string? Comments { get; set; }

        public DateTime FeedbackTimestamp { get; set; } = DateTime.Now;
    }
}

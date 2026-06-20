using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations.Schema;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model
{
    public class LogStatusHistory
    {
        [Key]
        public int LogStatusHistoryId { get; set; }

        [ForeignKey("Log")]
        public int LogId { get; set; }
        public Log? Log { get; set; }

        [ForeignKey("User")]
        public int ChangedByUserId { get; set; }
        public User? ChangedBy { get; set; }

        public string? LogStatus { get; set; }

        public DateTime UpdatedAt { get; set; } = DateTime.Now;
    }
}

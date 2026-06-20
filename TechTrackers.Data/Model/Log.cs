using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model
{
    public class Log
    {
        /*public Log() {         
            IssueId = string.Empty;
        }*/

        [Key]
        public int LogId { get; set; }

        public string? IssueId { get; set; }

        public int UserIssueId { get; set; }
        public string? Description { get; set; }

        public string? Priority { get; set; } // 'LOW', 'MEDIUM', 'HIGH'

        public DateTime? ResolutionDue { get; set; }
        public DateTime? ResponseDue { get; set; }
        public byte[]? AttachmentFile { get; set; }
        public int EscalationLevel { get; set; }
        public int? AssignedBy { get; set; } // Foreign Key for AssignedByUser
        public User? AssignedByUser { get; set; } // Navigation Property

        public string? Location { get; set; }
        public string? IssueTitle { get; set; }
        public string? LogStatus { get; set; } // 'PENDING', 'IN PROGRESS', 'RESOLVED', 'ON HOLD'

        public int? TechnicianId { get; set; } // Foreign Key for Technician
        public User? Technician { get; set; } // Navigation Property

        public int StaffId { get; set; } // Foreign Key for Staff
        public User? Staff { get; set; } // Navigation Property

        public int CategoryId { get; set; } // Foreign Key for Category
        public Category? Category { get; set; } // Navigation Property

        public int? SLAId { get; set; } // Foreign Key for SLA
        public SLA? SLA { get; set; } // Navigation Property

        public string? Note { get; set; } //Add note if log is on hold

        //public string? Material { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.Now;
        public DateTime AssignedAt { get; set; } = DateTime.Now;
        public DateTime UpdatedAt { get; set; } = DateTime.Now;
    }

}

using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model
{
    public class Technician
    {
        [Key]
        [ForeignKey("User")]
        public int TechnicianId { get; set; } // Same as UserId for one-to-one mapping
        public User? User { get; set; }

        public string? Specialization { get; set; }
        public string? Contacts { get; set; }
        public TimeSpan FromTime { get; set; } // Start of availability
        public TimeSpan ToTime { get; set; }
        public string? TechnicianType { get; set; } // "internal" or "external"
        public string? Location { get; set; } // For external technicians
    }
}

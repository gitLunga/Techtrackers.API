using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations.Schema;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model
{
    public class SLA
    {
        [Key]
        public int SLAId { get; set; }

        public string Description { get; set; } = string.Empty;
        public int ResponseTimeframe { get; set; }
        public int ResolutionTimeframe { get; set; } // In hours

        [Required]
        public string? PriorityLevel { get; set; }
    }
}

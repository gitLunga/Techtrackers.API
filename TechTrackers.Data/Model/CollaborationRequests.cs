using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model
{
    public class CollaborationRequests
    {
        [Key]

        [DatabaseGenerated(DatabaseGeneratedOption.Identity)]

        public int CollaboratedId { get; set; }
        public string? Status { get; set; }
        public DateTime? CreatedAt { get; set; }
        public DateTime? UpdatedAt { get; set; }

        public int? RequestingTechnicianId { get; set; }
        public int? InvitedTechnicianId { get; set; }
        public int? LogId { get; set; }

        [ForeignKey("RequestingTechnicianId")]
        public User? RequestTech { get; set; }

        [ForeignKey("InvitedTechnicianId")]
        public User? InviteTech { get; set; }
        
       
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model.dto
{
    public class CollabRequestDto
    {
        public int LogId { get; set; }
        public int RequestingTechnicianId { get; set; }
        public int InvitedTechnicianId { get; set; }
    }
}

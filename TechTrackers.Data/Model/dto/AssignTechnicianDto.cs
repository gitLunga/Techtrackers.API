using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model.dto
{
    public class AssignTechnicianDto
    {
        public int LogId { get; set; }
        public int TechnicianId { get; set; }
        public int AssignedBy { get; set; }
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model.dto
{
    public class DepartmentDTO
    {
        public int DepartmentId { get; set; } // For Get, Update, and Delete operations
        public string DepartmentName { get; set; } = string.Empty; // Common for all operations
     //   public List<int>? UserIds { get; set; } // For handling related users if needed
    }
}

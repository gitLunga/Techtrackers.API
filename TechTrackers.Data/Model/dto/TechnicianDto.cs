using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model.dto
{
    public class TechnicianDto
    {
        public string Surname { get; set; } = string.Empty;
        public string Initials { get; set; } = string.Empty;
        public string EmailAddress { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
        public int DepartmentId { get; set; }
        public string? FromTime { get; set; } = string.Empty;
        public string? ToTime { get; set; } = string.Empty;
        public string Specialization { get; set; } = string.Empty;
        public string Contacts { get; set; } = string.Empty;
        public string? TechnicianType { get; set; }
        public string? Location { get; set; }
        public int ActiveTasks { get; set; }
        public int NoOfTask { get; set; }
    }
}

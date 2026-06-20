using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations.Schema;
using System.ComponentModel.DataAnnotations;
using System.Data;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model
{
    public class User
    {
        [Key]
        public int UserId { get; set; }
        [Required]
        public string Surname { get; set; } = string.Empty;
        public string Initials { get; set; } = string.Empty;
        [EmailAddress]
        public string? EmailAddress { get; set; }
        [Required]
        public string? PasswordHash { get; set; }

        [ForeignKey("Department")]
        public int DepartmentId { get; set; }
        public Department? Department { get; set; }

        [ForeignKey("Role")]
        public int RoleId { get; set; }
        public Role? Role { get; set; }

        public virtual ICollection<UserRole> UserRoles { get; set; } = new List<UserRole>();
        public virtual ICollection<Log> AssignedLogs { get; set; } = new List<Log>();
        public virtual ICollection<Log> CreatedLogs { get; set; } = new List<Log>();

    }
}

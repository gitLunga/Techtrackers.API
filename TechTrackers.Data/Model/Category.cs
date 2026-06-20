using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations.Schema;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model
{
    public class Category
    {
        [Key]     
        public int CategoryId { get; set; }

        [Required]
        public string? CategoryName { get; set; }

        public virtual ICollection<Log> Logs { get; set; } = new List<Log>();
    }
}

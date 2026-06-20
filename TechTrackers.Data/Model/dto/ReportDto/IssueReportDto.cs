using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model.dto.ReportDto
{
    public class IssueReportDto
    {
        public int LogId { get; set; }
        public string IssueTitle { get; set; }
        public string Priority { get; set; }
        public string Technician { get; set; }
        public string Status { get; set; }
        public DateTime DateCreated { get; set; }
        public DateTime? DueDate { get; set; }
        public DateTime? DateClosed { get; set; }
    }
}
